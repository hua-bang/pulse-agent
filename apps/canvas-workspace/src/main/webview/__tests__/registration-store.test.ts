import { describe, expect, it } from 'vitest';

import { WebviewRegistrationStore } from '../registration-store';

describe('WebviewRegistrationStore', () => {
  it('promotes an older presentation when the active guest is rebound to another node', () => {
    const store = new WebviewRegistrationStore();
    const oldNode = { workspaceId: 'workspace-1', nodeId: 'node-old' };
    const newNode = { workspaceId: 'workspace-1', nodeId: 'node-new' };

    expect(store.register(oldNode, 101, 'canvas-node')).toBe(true);
    expect(store.register(oldNode, 202, 'dock-browser')).toBe(true);
    expect(store.getByNode(oldNode)?.webContentsId).toBe(202);

    expect(store.register(newNode, 202, 'dock-browser')).toBe(false);

    expect(store.getByNode(oldNode)).toEqual({
      workspaceId: 'workspace-1',
      nodeId: 'node-old',
      webContentsId: 101,
      surfaceKind: 'canvas-node',
    });
    expect(store.getByNode(newNode)).toEqual({
      workspaceId: 'workspace-1',
      nodeId: 'node-new',
      webContentsId: 202,
      surfaceKind: 'dock-browser',
    });
    expect(store.getByWebContentsId(202)).toEqual(store.getByNode(newNode));
    expect(store.size).toBe(2);
  });
});
