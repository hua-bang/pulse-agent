import { describe, expect, it, vi } from 'vitest';

const workspaces = vi.hoisted(() => ({
  readWorkspaceManifest: vi.fn(async () => ({ workspaces: [{ id: 'visible', name: 'Visible workspace' }] })),
  filterWorkspaceIds: vi.fn(async (_root: string, ids: string[]) => ids.filter(id => id !== 'trashed')),
}));
vi.mock('../canvas/workspaces', () => workspaces);
vi.mock('../canvas/storage', () => ({ readCanvasFull: async () => ({ data: null }) }));
vi.mock('../webview/registry', () => ({ getNodeRenderedText: vi.fn() }));
vi.mock('./plugin-node-capabilities', () => ({
  formatPluginNodeFallbackContent: vi.fn(), getPluginNodeCapabilityKinds: vi.fn(),
  getPluginNodeIdentity: vi.fn(), readPluginNodeCapability: vi.fn(),
}));

import { resolveWorkspaceNames } from './context-builder';

describe('Agent context workspace visibility', () => {
  it('uses the shared visible manifest and cannot reintroduce a trashed id through fallback naming', async () => {
    expect(await resolveWorkspaceNames(['visible', 'trashed', 'legacy-unlisted'])).toEqual([
      { id: 'visible', name: 'Visible workspace' },
      { id: 'legacy-unlisted', name: 'legacy-unlisted' },
    ]);
    expect(workspaces.readWorkspaceManifest).toHaveBeenCalledOnce();
    expect(workspaces.filterWorkspaceIds).toHaveBeenCalledWith(expect.any(String), ['visible', 'trashed', 'legacy-unlisted']);
  });
});
