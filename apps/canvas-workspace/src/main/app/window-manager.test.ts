import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({ windows: [] as any[] }));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => electron.windows,
    getFocusedWindow: () => null,
  },
}));

import { activateWorkspaceWindow } from './window-manager';

beforeEach(() => {
  electron.windows.length = 0;
});

describe('activateWorkspaceWindow', () => {
  it('routes to the target node so a discarded WebView is selected and woken', async () => {
    const executeJavaScript = vi.fn().mockResolvedValue(undefined);
    electron.windows.push({
      isDestroyed: () => false,
      isMinimized: () => false,
      isVisible: () => true,
      showInactive: vi.fn(),
      webContents: {
        executeJavaScript,
        isLoading: () => false,
        once: vi.fn(),
      },
    });

    await expect(activateWorkspaceWindow('workspace a', 'node/1')).resolves.toEqual({ ok: true });
    expect(executeJavaScript).toHaveBeenCalledOnce();
    expect(executeJavaScript.mock.calls[0]?.[0]).toContain(
      '#/?workspaceId=workspace+a&nodeId=node%2F1',
    );
  });

  it('returns a bounded failure when the main renderer load fails', async () => {
    const webContents = Object.assign(new EventEmitter(), {
      executeJavaScript: vi.fn(),
      isLoading: () => true,
    });
    electron.windows.push({
      isDestroyed: () => false,
      isMinimized: () => false,
      isVisible: () => true,
      showInactive: vi.fn(),
      webContents,
    });

    const result = activateWorkspaceWindow('workspace-a', 'node-a');
    webContents.emit(
      'did-fail-load',
      {},
      -105,
      'NAME_NOT_RESOLVED',
      'https://example.invalid/',
      true,
    );

    await expect(result).resolves.toEqual({
      ok: false,
      error: 'Canvas window failed to load (-105): NAME_NOT_RESOLVED',
    });
    expect(webContents.executeJavaScript).not.toHaveBeenCalled();
  });

  it('returns a bounded failure when the renderer is destroyed while loading', async () => {
    const webContents = Object.assign(new EventEmitter(), {
      executeJavaScript: vi.fn(),
      isLoading: () => true,
    });
    electron.windows.push({
      isDestroyed: () => false,
      isMinimized: () => false,
      isVisible: () => true,
      showInactive: vi.fn(),
      webContents,
    });

    const result = activateWorkspaceWindow('workspace-a');
    webContents.emit('destroyed');

    await expect(result).resolves.toEqual({
      ok: false,
      error: 'Canvas window was destroyed while loading.',
    });
  });
});
