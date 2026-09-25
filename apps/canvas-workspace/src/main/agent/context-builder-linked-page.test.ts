import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loaded: vi.fn(),
  readIframeContent: vi.fn(async () => 'Live page text'),
}));
vi.mock('./linked-page-context', () => {
  mocks.loaded();
  return { readIframeContent: mocks.readIframeContent };
});
vi.mock('../canvas/storage', () => ({
  readCanvasFull: async () => ({ data: {
    nodes: [
      { id: 'url', type: 'iframe', title: 'Link', x: 0, y: 0, width: 200, height: 100, data: { mode: 'url', url: 'https://example.test' } },
      { id: 'html', type: 'iframe', title: 'HTML', x: 0, y: 0, width: 200, height: 100, data: { mode: 'html', html: '<p>Saved HTML</p>' } },
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
import { buildWorkspaceSummary, readNodeDetail } from './context-builder';

describe('linked-page context loading boundary', () => {
  it('keeps summaries and stored HTML independent of the page reader, then awaits URL detail on demand', async () => {
    expect(mocks.loaded).not.toHaveBeenCalled();
    expect((await buildWorkspaceSummary('ws'))?.nodes).toHaveLength(2);
    expect((await readNodeDetail('ws', 'html'))?.content).toBe('<p>Saved HTML</p>');
    expect(mocks.loaded).not.toHaveBeenCalled();
    expect((await readNodeDetail('ws', 'url'))?.content).toBe('Live page text');
    expect(mocks.loaded).toHaveBeenCalledOnce();
    expect(mocks.readIframeContent).toHaveBeenCalledWith('ws', 'url', 'https://example.test');
  });
});
