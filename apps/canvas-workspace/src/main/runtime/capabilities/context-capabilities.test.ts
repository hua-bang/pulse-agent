import { describe, expect, it, vi } from 'vitest';

import { CapabilityRuntime } from './runtime';
import { createContextCapabilities } from './context-capabilities';

describe('Context capability', () => {
  it('reads the summary by default and the detailed context on request', async () => {
    const readSummary = vi.fn().mockResolvedValue({ workspaceId: 'ws-1', nodeCount: 2, nodes: [] });
    const readDetailed = vi.fn().mockResolvedValue({ workspaceId: 'ws-1', nodes: [{ id: 'n-1' }] });
    const runtime = new CapabilityRuntime(createContextCapabilities({ readSummary, readDetailed }));
    const context = { workspaceId: 'ws-1', actor: { kind: 'test' as const } };

    await expect(runtime.call('canvas.context.read', {}, context)).resolves.toEqual({
      ok: true,
      value: { workspaceId: 'ws-1', nodeCount: 2, nodes: [] },
    });
    await expect(runtime.call('canvas.context.read', { scope: 'detailed' }, context)).resolves.toMatchObject({
      ok: true,
      value: { nodes: [{ id: 'n-1' }] },
    });
    expect(readSummary).toHaveBeenCalledWith('ws-1');
    expect(readDetailed).toHaveBeenCalledWith('ws-1');
  });

  it('is a read-tier capability visible to the pulse-cli actor', () => {
    const runtime = new CapabilityRuntime(createContextCapabilities({
      readSummary: vi.fn(),
      readDetailed: vi.fn(),
    }));
    expect(runtime.list({ kind: 'pulse-cli' })).toContainEqual(expect.objectContaining({
      name: 'canvas.context.read',
      risk: 'read',
    }));
  });

  it('surfaces a missing workspace as workspace_not_found', async () => {
    const runtime = new CapabilityRuntime(createContextCapabilities({
      readSummary: vi.fn().mockRejectedValue(
        Object.assign(new Error('workspace not found: ws-x'), { code: 'workspace_not_found' }),
      ),
      readDetailed: vi.fn(),
    }));
    const result = await runtime.call(
      'canvas.context.read',
      {},
      { workspaceId: 'ws-x', actor: { kind: 'test' as const } },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('workspace not found');
  });
});
