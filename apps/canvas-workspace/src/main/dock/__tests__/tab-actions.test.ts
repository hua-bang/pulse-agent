import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  ipcHandlers: new Map<string, (...args: any[]) => void>(),
  windows: [{
    isDestroyed: () => false,
    webContents: { id: 7, send: vi.fn() },
  }],
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => mocks.windows,
  },
  ipcMain: {
    on: (channel: string, handler: (...args: any[]) => void) => {
      mocks.ipcHandlers.set(channel, handler);
    },
  },
}));
vi.mock('../tab-store', () => ({ getDockTabs: () => [] }));

import { activateDockTab, setupDockTabActionsIpc } from '../tab-actions';

describe('activateDockTab', () => {
  beforeEach(() => {
    mocks.windows = [{
      isDestroyed: () => false,
      webContents: { id: 7, send: mocks.send },
    }];
    mocks.send.mockReset();
    mocks.ipcHandlers.clear();
    setupDockTabActionsIpc();
  });

  it('preserves the current route and reports success only after renderer acknowledgement', async () => {
    const activation = activateDockTab('ws-1', 'terminal');
    const payload = mocks.send.mock.calls[0]?.[1];
    expect(mocks.send).toHaveBeenCalledWith('dock:activate-tab', {
      requestId: expect.any(String),
      workspaceId: 'ws-1',
      tabId: 'terminal',
    });
    mocks.ipcHandlers.get('dock:tab-activation-result')?.(
      { sender: { id: 7 } },
      { requestId: payload.requestId, workspaceId: 'ws-1', tabId: 'terminal', ok: true },
    );
    await expect(activation).resolves.toBe(true);
  });

  it('reports failure when every renderer rejects a stale tab', async () => {
    const activation = activateDockTab('ws-stale', 'terminal');
    const payload = mocks.send.mock.calls[0]?.[1];
    mocks.ipcHandlers.get('dock:tab-activation-result')?.(
      { sender: { id: 7 } },
      {
        requestId: payload.requestId,
        workspaceId: 'ws-stale',
        tabId: 'terminal',
        ok: false,
        error: 'stale',
      },
    );
    await expect(activation).resolves.toBe(false);
  });

  it('does not report success when no renderer can receive the command', async () => {
    mocks.windows = [];
    await expect(activateDockTab('ws-stale', 'terminal')).resolves.toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
