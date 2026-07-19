import { beforeEach, describe, expect, it, vi } from 'vitest';

const executeHostRendererEval = vi.hoisted(() => vi.fn());

vi.mock('./host-renderer-execution', () => ({ executeHostRendererEval }));

import { createHostRendererCapabilities } from './host-renderer-capabilities';

describe('host renderer capability contract', () => {
  beforeEach(() => executeHostRendererEval.mockReset());

  it('forwards validated input and workspace context to the lazy executor', async () => {
    executeHostRendererEval.mockResolvedValue({
      action: 'host_renderer_eval',
      value: { title: 'Pulse Canvas' },
    });
    const [capability] = createHostRendererCapabilities();
    const context = { workspaceId: 'ws-1', actor: { kind: 'pulse-cli' as const } };

    const result = await capability.execute(
      { code: 'return document.title', timeoutMs: 2_000 },
      context,
    );

    expect(executeHostRendererEval).toHaveBeenCalledWith(
      { code: 'return document.title', timeoutMs: 2_000 },
      context,
    );
    expect(result).toEqual({
      action: 'host_renderer_eval',
      value: { title: 'Pulse Canvas' },
    });
  });
});
