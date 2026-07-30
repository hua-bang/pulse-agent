import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Guards the live progress of a scheduled run.
 *
 * A background run had no visible process at all: `executeScheduledTask`
 * called `chatWithScope` with no stream callbacks, so `buildEngineStreamCallbacks`
 * dropped every chunk the engine emitted and the task's conversation could only
 * show a static placeholder until the whole run finished. These tests pin the
 * three properties that fix depends on:
 *  - tool calls/results and the first text delta reach the renderer as
 *    `scheduled:run-progress` pushes;
 *  - the delta firehose is NOT forwarded (one `writing` push per run);
 *  - a mid-run snapshot exists for a panel that opens late, and is gone once
 *    the run ends.
 */
type ChatCallbacks = {
  onText?: (delta: string) => void;
  onToolCall?: (data: { name: string; args?: unknown; toolCallId?: string }) => void;
  onToolResult?: (data: { name: string; result: string; toolCallId?: string }) => void;
};

const h = vi.hoisted(() => ({
  sent: [] as Array<{ channel: string; payload: any }>,
  abortedScopes: [] as unknown[],
  /** Body of the fake turn: receives the callbacks main handed the service. */
  turn: null as null | ((callbacks: ChatCallbacks) => Promise<void>),
  chatResult: { ok: true } as { ok: boolean; error?: string },
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => { h.sent.push({ channel, payload }); },
        },
      },
    ],
  },
}));

vi.mock('../agent/ipc', () => ({
  getCanvasAgentService: () => ({
    chatWithScope: async (
      _scope: unknown,
      _message: string,
      onText?: ChatCallbacks['onText'],
      onToolCall?: ChatCallbacks['onToolCall'],
      onToolResult?: ChatCallbacks['onToolResult'],
    ) => {
      await h.turn?.({ onText, onToolCall, onToolResult });
      return h.chatResult;
    },
    resolveCurrentSessionId: async () => 'session-1',
    abortScope: (scope: unknown) => { h.abortedScopes.push(scope); },
  }),
}));

import { __testing, cancelScheduledRun, getScheduledRunProgress } from '../scheduled/runtime';
import type { ScheduledRunProgress, ScheduledTask } from '../../shared/scheduled';

const task: ScheduledTask = {
  id: 'daily-brief',
  title: 'Morning brief',
  prompt: 'Summarize what needs my attention.',
  schedule: { kind: 'daily', timeOfDay: '09:00' },
  enabled: true,
  source: 'user',
  createdAt: 1,
  updatedAt: 1,
  nextRunAt: 2,
  runCount: 0,
  status: 'running',
};

const progressPushes = (): ScheduledRunProgress[] => h.sent
  .filter((event) => event.channel === 'scheduled:run-progress')
  .map((event) => event.payload as ScheduledRunProgress);

const finishedPushes = () => h.sent
  .filter((event) => event.channel === 'scheduled:run-finished')
  .map((event) => event.payload);

beforeEach(() => {
  h.sent.length = 0;
  h.abortedScopes.length = 0;
  h.turn = null;
  h.chatResult = { ok: true };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('scheduled run progress', () => {
  it('pushes the tool trail and the writing phase, and ends with a done event', async () => {
    h.turn = async ({ onText, onToolCall, onToolResult }) => {
      onToolCall?.({ name: 'notion_search', toolCallId: 'call-1' });
      onToolResult?.({ name: 'notion_search', result: '{}', toolCallId: 'call-1' });
      onToolCall?.({ name: 'canvas_read_node', toolCallId: 'call-2' });
      onToolResult?.({ name: 'canvas_read_node', result: '{}', toolCallId: 'call-2' });
      onText?.('Here');
      onText?.(' is');
      onText?.(' the brief');
    };

    await __testing.executeScheduledTask(task);

    const pushed = progressPushes();
    expect(pushed.map((progress) => progress.phase)).toEqual([
      'starting',
      'tool', 'thinking',
      'tool', 'thinking',
      // Three deltas, ONE writing push: forwarding the token stream would turn
      // a background run into an IPC storm.
      'writing',
      'done',
    ]);
    expect(pushed.every((progress) => progress.taskId === 'daily-brief')).toBe(true);

    const writing = pushed.find((progress) => progress.phase === 'writing')!;
    expect(writing.toolCalls).toBe(2);
    expect(writing.steps).toEqual([
      expect.objectContaining({ index: 1, name: 'notion_search', status: 'done' }),
      expect.objectContaining({ index: 2, name: 'canvas_read_node', status: 'done' }),
    ]);
  });

  it('exposes a mid-run snapshot for a panel that opens late, and drops it after the run', async () => {
    let midRun: ScheduledRunProgress | undefined;
    h.turn = async ({ onToolCall }) => {
      onToolCall?.({ name: 'feishu_docs_read', toolCallId: 'call-1' });
      midRun = getScheduledRunProgress('daily-brief');
    };

    await __testing.executeScheduledTask(task);

    expect(midRun).toMatchObject({
      taskId: 'daily-brief',
      phase: 'tool',
      toolCalls: 1,
      steps: [expect.objectContaining({ name: 'feishu_docs_read', status: 'running' })],
    });
    expect(getScheduledRunProgress('daily-brief')).toBeUndefined();
  });

  it('matches a tool result to its step even when the dialect omits the call id', async () => {
    let midRun: ScheduledRunProgress | undefined;
    h.turn = async ({ onToolCall, onToolResult }) => {
      onToolCall?.({ name: 'bash' });
      onToolResult?.({ name: 'bash', result: 'ok' });
      midRun = getScheduledRunProgress('daily-brief');
    };

    await __testing.executeScheduledTask(task);

    expect(midRun?.steps).toEqual([expect.objectContaining({ name: 'bash', status: 'done' })]);
    expect(midRun?.phase).toBe('thinking');
  });

  it('flags a user-stopped run instead of reporting it as a fault', async () => {
    h.turn = async ({ onToolCall }) => {
      onToolCall?.({ name: 'notion_search', toolCallId: 'call-1' });
      expect(cancelScheduledRun('daily-brief')).toEqual({ ok: true });
      // The engine's reaction to the abort: the turn fails.
      h.chatResult = { ok: false, error: 'Aborted' };
    };

    await expect(__testing.executeScheduledTask(task)).rejects.toThrow('Aborted');

    expect(h.abortedScopes).toEqual([{ kind: 'scheduled', taskId: 'daily-brief' }]);
    expect(finishedPushes()[0]).toEqual({
      taskId: 'daily-brief',
      title: 'Morning brief',
      ok: false,
      error: 'Aborted',
      cancelled: true,
    });
    expect(progressPushes().some((progress) => progress.cancelRequested === true)).toBe(true);
  });

  it('refuses to stop a task with no run in flight rather than aborting an unrelated turn', () => {
    expect(cancelScheduledRun('daily-brief')).toEqual({
      ok: false,
      error: 'No scheduled run in flight',
    });
    expect(h.abortedScopes).toEqual([]);
  });

  it('ends the run even when the turn throws, so no stale progress survives', async () => {
    h.turn = async () => { throw new Error('engine exploded'); };

    await expect(__testing.executeScheduledTask(task)).rejects.toThrow('engine exploded');

    expect(getScheduledRunProgress('daily-brief')).toBeUndefined();
    expect(progressPushes().at(-1)?.phase).toBe('done');
  });
});
