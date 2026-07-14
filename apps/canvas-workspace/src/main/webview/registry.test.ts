import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  webContents: new Map<number, {
    id: number;
    isDestroyed: () => boolean;
    once: ReturnType<typeof vi.fn>;
  }>(),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [],
    getFocusedWindow: () => null,
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => any) => {
      electron.handlers.set(channel, handler);
    },
  },
  webContents: {
    fromId: (id: number) => electron.webContents.get(id) ?? null,
  },
}));

import { getWebContentsForNode, setupWebviewRegistryIpc } from './registry';

beforeEach(() => {
  electron.handlers.clear();
  electron.webContents.clear();
  for (const id of [101, 202]) {
    electron.webContents.set(id, {
      id,
      isDestroyed: () => false,
      once: vi.fn(),
    });
  }
  setupWebviewRegistryIpc();
});

describe('webview registry generations', () => {
  it('does not let an old guest unregister a newer replacement', async () => {
    const register = electron.handlers.get('iframe:register-webview');
    const unregister = electron.handlers.get('iframe:unregister-webview');
    expect(register).toBeTypeOf('function');
    expect(unregister).toBeTypeOf('function');

    await register?.({}, {
      nodeId: 'node-1',
      webContentsId: 101,
      workspaceId: 'workspace-1',
    });
    await register?.({}, {
      nodeId: 'node-1',
      webContentsId: 202,
      workspaceId: 'workspace-1',
    });
    await unregister?.({}, {
      nodeId: 'node-1',
      webContentsId: 101,
      workspaceId: 'workspace-1',
    });

    expect(getWebContentsForNode('workspace-1', 'node-1')).toMatchObject({ id: 202 });

    await unregister?.({}, {
      nodeId: 'node-1',
      webContentsId: 202,
      workspaceId: 'workspace-1',
    });
    expect(getWebContentsForNode('workspace-1', 'node-1')).toBeNull();
  });
});
