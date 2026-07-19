import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeCall = vi.hoisted(() => vi.fn());

vi.mock('../../../main/runtime/capabilities', () => ({
  getCanvasCapabilityRuntime: () => ({ call: runtimeCall }),
}));

import { createHostRendererControlTools } from './tools';

describe('canvas_host_eval capability adapter', () => {
  beforeEach(() => runtimeCall.mockReset());

  it('routes host scripts through host.renderer.eval with workspace and abort context', async () => {
    runtimeCall.mockResolvedValue({
      ok: true,
      value: { action: 'host_renderer_eval', value: { sent: true } },
    });
    const abortController = new AbortController();

    const output = JSON.parse(await createHostRendererControlTools('ws-1').canvas_host_eval.execute(
      { code: 'return { sent: true }', timeoutMs: 1_500 },
      { abortSignal: abortController.signal },
    ));

    expect(runtimeCall).toHaveBeenCalledWith(
      'host.renderer.eval',
      { code: 'return { sent: true }', timeoutMs: 1_500 },
      {
        workspaceId: 'ws-1',
        actor: { kind: 'canvas-agent' },
        abortSignal: abortController.signal,
      },
    );
    expect(output).toEqual({ ok: true, action: 'host_renderer_eval', value: { sent: true } });
  });
});
