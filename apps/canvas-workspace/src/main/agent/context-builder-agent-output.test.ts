import { describe, expect, it, vi } from 'vitest';

vi.mock('../canvas/storage', () => ({
  readCanvasFull: async () => ({ data: {
    nodes: [
      { id: 'live', type: 'agent', title: 'Live', x: 0, y: 0, width: 200, height: 100, data: { sessionId: 'pty-live', scrollback: 'stale' } },
      { id: 'gone', type: 'agent', title: 'Gone', x: 0, y: 0, width: 200, height: 100, data: { sessionId: 'pty-gone', scrollback: 'saved by an older release' } },
    ],
    edges: [],
  } }),
}));
vi.mock('../canvas/workspaces', () => ({
  readWorkspaceManifest: async () => ({ workspaces: [{ id: 'ws', name: 'Workspace' }] }),
  filterWorkspaceIds: async (_root: string, ids: string[]) => ids,
}));
vi.mock('./plugin-node-capabilities', () => ({
  formatPluginNodeFallbackContent: vi.fn(), getPluginNodeCapabilityKinds: vi.fn(),
  getPluginNodeIdentity: vi.fn(), readPluginNodeCapability: vi.fn(),
}));
import { readNodeDetail } from './context-builder';
import { publishSessionSnapshot } from '../terminal/session-output';

describe('Coding Agent node detail', () => {
  it('reads live output from main and falls back to saved text only for unknown sessions', async () => {
    publishSessionSnapshot('pty-live', 'live agent output');
    expect((await readNodeDetail('ws', 'live'))?.scrollback).toBe('live agent output');
    expect((await readNodeDetail('ws', 'gone'))?.scrollback).toBe('saved by an older release');
  });
});
