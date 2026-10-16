import { describe, expect, it, vi } from 'vitest';
import { CapabilityRuntime } from '../../main/runtime/capabilities/runtime';
import type { CanvasAgentDebugRunDetail } from '../../main/agent/types';
import { createDevtoolsCapabilities } from './devtools-capabilities';

const window = vi.hoisted(() => ({
  isDestroyed: () => false,
  webContents: { executeJavaScript: vi.fn().mockResolvedValue(undefined) },
  show: vi.fn(), focus: vi.fn(),
}));
vi.mock('../../main/runtime/window-port', () => ({
  getRuntimeWindowPort: () => ({ getCanvasWindow: () => window }),
}));

const context = { workspaceId: 'ws-1', actor: { kind: 'pulse-cli' as const } };
const runs = [
  { runId: 'r-2', sessionId: 's-1', workspaceId: 'ws-1' },
  { runId: 'r-1', sessionId: 's-1', workspaceId: 'ws-1' },
  { runId: 'other', sessionId: 's-1', workspaceId: 'ws-2' },
] as CanvasAgentDebugRunDetail[];
const runtime = () => new CapabilityRuntime(createDevtoolsCapabilities({
  listRuns: async () => runs,
  getRun: async id => runs.find(run => run.runId === id),
}));

describe('DevTools runtime capabilities', () => {
  it('returns run details and session runs in store order, confined to the workspace', async () => {
    const api = runtime();
    expect(await api.call('devtools.logs.query', { runId: 'r-1' }, context))
      .toEqual({ ok: true, value: { runs: [runs[1]] } });
    expect(await api.call('devtools.logs.query', { sessionId: 's-1' }, context))
      .toEqual({ ok: true, value: { runs: runs.slice(0, 2) } });
    expect(await api.call('devtools.logs.query', { runId: 'other' }, context))
      .toMatchObject({ ok: false, error: { code: 'run_not_found' } });
    expect(await api.call('devtools.logs.query', { sessionId: 'missing' }, context))
      .toEqual({ ok: true, value: { runs: [] } });
  });

  it('rejects ambiguous selectors, unsafe store keys, and pre-aborted calls', async () => {
    const api = runtime();
    for (const input of [{}, { runId: 'r-1', sessionId: 's-1' }, { runId: '../secret' }]) {
      expect(await api.call('devtools.logs.query', input, context))
        .toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    }
    const controller = new AbortController();
    controller.abort();
    expect(await api.call('devtools.logs.open', { runId: 'r-1' }, { ...context, abortSignal: controller.signal }))
      .toMatchObject({ ok: false, error: { code: 'aborted' } });
  });

  it('opens the existing route with exact session and workspace filters', async () => {
    expect(await runtime().call('devtools.logs.open', { sessionId: 's-1' }, context))
      .toEqual({ ok: true, value: { opened: true, route: '/debug?workspaceId=ws-1&sessionId=s-1' } });
    expect(window.webContents.executeJavaScript).toHaveBeenCalledWith(
      'window.location.hash = "/debug?workspaceId=ws-1&sessionId=s-1"; void 0;',
    );
    expect(window.focus).toHaveBeenCalledOnce();
    expect(await runtime().call('devtools.logs.open', { sessionId: 'missing' }, context))
      .toMatchObject({ ok: false, error: { code: 'session_not_found' } });
  });
});
