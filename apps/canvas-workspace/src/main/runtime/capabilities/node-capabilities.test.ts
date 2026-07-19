import { describe, expect, it, vi } from 'vitest';

import { CapabilityRuntime } from './runtime';
import { createNodeCapabilities } from './node-capabilities';

describe('Node capabilities', () => {
  it('reads and searches nodes through workspace-scoped services', async () => {
    const readNode = vi.fn().mockResolvedValue({ id: 'n-1', type: 'text', content: 'hello' });
    const searchNodes = vi.fn().mockResolvedValue({
      workspaceId: 'ws-1',
      total: 1,
      truncated: false,
      matches: [{ id: 'n-1', type: 'text', title: 'Note', snippet: 'hello', x: 0, y: 0 }],
    });
    const runtime = new CapabilityRuntime(createNodeCapabilities({
      readNode,
      searchNodes,
      updateNode: vi.fn(),
    }));
    const context = { workspaceId: 'ws-1', actor: { kind: 'test' as const } };

    await expect(runtime.call('canvas.nodes.read', { nodeId: 'n-1' }, context)).resolves.toEqual({
      ok: true,
      value: { id: 'n-1', type: 'text', content: 'hello' },
    });
    await expect(runtime.call(
      'canvas.nodes.search',
      { query: 'hello', type: 'text', limit: 5 },
      context,
    )).resolves.toMatchObject({ ok: true, value: { total: 1 } });

    expect(readNode).toHaveBeenCalledWith('ws-1', 'n-1');
    expect(searchNodes).toHaveBeenCalledWith('ws-1', {
      query: 'hello',
      type: 'text',
      limit: 5,
    });
  });

  it('updates only through the operate-class capability', async () => {
    const updateNode = vi.fn().mockResolvedValue({ nodeId: 'n-1' });
    const runtime = new CapabilityRuntime(createNodeCapabilities({
      readNode: vi.fn(),
      searchNodes: vi.fn(),
      updateNode,
    }));
    const context = { workspaceId: 'ws-1', actor: { kind: 'test' as const } };

    await expect(runtime.call(
      'canvas.nodes.update',
      { nodeId: 'n-1', title: 'Updated', content: 'new body' },
      context,
    )).resolves.toEqual({ ok: true, value: { nodeId: 'n-1' } });
    expect(updateNode).toHaveBeenCalledWith('ws-1', {
      nodeId: 'n-1',
      title: 'Updated',
      content: 'new body',
    });
    expect(runtime.list({ kind: 'test' })).toContainEqual(expect.objectContaining({
      name: 'canvas.nodes.update',
      risk: 'operate',
    }));
  });

  it('blocks generic data patches from Pulse CLI while preserving title/content updates', async () => {
    const updateNode = vi.fn().mockResolvedValue({ nodeId: 'n-1' });
    const runtime = new CapabilityRuntime(createNodeCapabilities({
      readNode: vi.fn(),
      searchNodes: vi.fn(),
      updateNode,
    }));
    const context = { workspaceId: 'ws-1', actor: { kind: 'pulse-cli' as const } };

    await expect(runtime.call(
      'canvas.nodes.update',
      { nodeId: 'n-1', data: { filePath: '/tmp/redirected.md' } },
      context,
    )).resolves.toEqual({
      ok: false,
      error: {
        code: 'unsafe_input',
        message: 'Pulse CLI may update node title/content but cannot patch internal data fields.',
      },
    });
    expect(updateNode).not.toHaveBeenCalled();

    await expect(runtime.call(
      'canvas.nodes.update',
      { nodeId: 'n-1', content: 'safe update' },
      context,
    )).resolves.toEqual({ ok: true, value: { nodeId: 'n-1' } });
  });
});
