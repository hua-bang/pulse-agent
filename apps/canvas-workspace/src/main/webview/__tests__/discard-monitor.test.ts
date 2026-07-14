import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { FreezeRecord } from '../freeze-probe';

/**
 * L3 sweep safety: candidates whose FREEZE-TIME record says dirty or
 * non-reloadable (and frozen pages with no record at all — fail closed) are
 * never discarded, but their RSS still counts toward the budget projection
 * so other pages get discarded instead. Discard notifications carry the
 * record's restore fields.
 */

interface FakeEntryWc {
  isDestroyed: () => boolean;
  getOSProcessId: () => number;
  capturePage: () => Promise<never>;
  frozenSince?: number;
}

const mocks = vi.hoisted(() => ({
  entries: [] as Array<{ workspaceId: string; nodeId: string; wc: unknown }>,
  metrics: [] as Array<{ pid: number; memory: { workingSetSize: number } }>,
  sent: [] as Array<{ channel: string; payload: Record<string, unknown> }>,
}));

vi.mock('electron', () => ({
  app: { getAppMetrics: () => mocks.metrics },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: Record<string, unknown>) => {
            mocks.sent.push({ channel, payload });
          },
        },
      },
    ],
  },
}));

vi.mock('../registry', () => ({
  listRegisteredWebviews: () => mocks.entries,
}));

vi.mock('../lifecycle', () => ({
  getFrozenSince: (wc: FakeEntryWc) => wc.frozenSince,
}));

import {
  forgetFreezeSnapshot,
  rememberFreezeSnapshot,
  startWebviewDiscardMonitor,
} from '../discard-monitor';

const KEYS = ['ws::dirty-node', 'ws::locked-node', 'ws::clean-node', 'ws::bare-node'];

const addGuest = (
  nodeId: string,
  pid: number,
  rssMB: number,
  frozenSince?: number,
): void => {
  const wc: FakeEntryWc = {
    isDestroyed: () => false,
    getOSProcessId: () => pid,
    // Rejecting keeps the bounded live-capture fallback instant in tests.
    capturePage: () => Promise.reject(new Error('hidden guest')),
    frozenSince,
  };
  mocks.entries.push({ workspaceId: 'ws', nodeId, wc });
  mocks.metrics.push({ pid, memory: { workingSetSize: rssMB * 1024 } });
};

const record = (overrides: Partial<FreezeRecord> = {}): FreezeRecord => ({
  imageDataUrl: 'data:image/png;snap',
  url: 'https://example.com/',
  scrollX: 0,
  scrollY: 0,
  dirty: false,
  reloadable: true,
  ...overrides,
});

const runSweep = async (): Promise<() => void> => {
  const stop = startWebviewDiscardMonitor();
  await vi.advanceTimersByTimeAsync(30_000);
  return stop;
};

let logSpy: MockInstance<Parameters<typeof console.log>, void>;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.entries.length = 0;
  mocks.metrics.length = 0;
  mocks.sent.length = 0;
  for (const key of KEYS) forgetFreezeSnapshot(key);
  process.env.PULSE_CANVAS_WEBVIEW_MEMORY_BUDGET_MB = '1000';
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  delete process.env.PULSE_CANVAS_WEBVIEW_MEMORY_BUDGET_MB;
  logSpy.mockRestore();
});

describe('discard sweep freeze-record guards', () => {
  it('skips a dirty candidate (with a logged reason) and discards the next clean one', async () => {
    addGuest('dirty-node', 1, 800, 1_000); // oldest frozen — normally first out
    addGuest('clean-node', 2, 800, 2_000);
    rememberFreezeSnapshot('ws::dirty-node', record({ dirty: true }));
    rememberFreezeSnapshot('ws::clean-node', record({ url: 'https://example.com/page2', scrollX: 5, scrollY: 1200 }));

    const stop = await runSweep();
    stop();

    expect(mocks.sent).toHaveLength(1);
    expect(mocks.sent[0].channel).toBe('iframe:discarded');
    expect(mocks.sent[0].payload).toMatchObject({
      workspaceId: 'ws',
      nodeId: 'clean-node',
      snapshotDataUrl: 'data:image/png;snap',
      restoreUrl: 'https://example.com/page2',
      scrollX: 5,
      scrollY: 1200,
    });
    const skipLines = logSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('skip'));
    expect(skipLines).toHaveLength(1);
    expect(skipLines[0]).toContain('ws::dirty-node');
    expect(skipLines[0]).toContain('dirty');
  });

  it('skips a non-reloadable candidate', async () => {
    addGuest('locked-node', 1, 800, 1_000);
    addGuest('clean-node', 2, 800, 2_000);
    rememberFreezeSnapshot('ws::locked-node', record({ url: 'blob:https://a/x', reloadable: false }));
    rememberFreezeSnapshot('ws::clean-node', record());

    const stop = await runSweep();
    stop();

    expect(mocks.sent.map((s) => s.payload.nodeId)).toEqual(['clean-node']);
    const skipLines = logSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('skip'));
    expect(skipLines[0]).toContain('ws::locked-node');
    expect(skipLines[0]).toContain('non-reloadable');
  });

  it('fails closed: a frozen page with NO freeze record is never discarded', async () => {
    addGuest('bare-node', 1, 800, 1_000);
    addGuest('clean-node', 2, 800, 2_000);
    rememberFreezeSnapshot('ws::clean-node', record());

    const stop = await runSweep();
    stop();

    expect(mocks.sent.map((s) => s.payload.nodeId)).toEqual(['clean-node']);
    const skipLines = logSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('skip'));
    expect(skipLines[0]).toContain('ws::bare-node');
    expect(skipLines[0]).toContain('no freeze-time record');
  });

  it("a blocked candidate's RSS still counts toward the projection", async () => {
    // dirty 900MB + clean 200MB = 1100 > 1000 budget. Discarding clean
    // (projection 900 ≤ 1000) suffices ONLY because dirty's RSS stayed in
    // the total; if it were dropped from the projection the sweep would
    // think it was already under budget and discard nothing.
    addGuest('dirty-node', 1, 900, 1_000);
    addGuest('clean-node', 2, 200, 2_000);
    rememberFreezeSnapshot('ws::dirty-node', record({ dirty: true }));
    rememberFreezeSnapshot('ws::clean-node', record());

    const stop = await runSweep();
    stop();

    expect(mocks.sent.map((s) => s.payload.nodeId)).toEqual(['clean-node']);
  });

  it('stays quiet under budget: no discards, no skip spam for blocked pages', async () => {
    addGuest('dirty-node', 1, 300, 1_000);
    rememberFreezeSnapshot('ws::dirty-node', record({ dirty: true }));

    const stop = await runSweep();
    stop();

    expect(mocks.sent).toHaveLength(0);
    const skipLines = logSpy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('skip'));
    expect(skipLines).toHaveLength(0);
  });

  it('falls back to a card placeholder (no image) when the record has none', async () => {
    addGuest('clean-node', 1, 1_200, 1_000);
    rememberFreezeSnapshot('ws::clean-node', record({ imageDataUrl: undefined }));

    const stop = await runSweep();
    stop();

    expect(mocks.sent).toHaveLength(1);
    expect(mocks.sent[0].payload.snapshotDataUrl).toBeUndefined();
    expect(mocks.sent[0].payload.restoreUrl).toBe('https://example.com/');
  });
});
