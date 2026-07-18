import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  activateWorkspaceWindow: vi.fn(async (): Promise<{ ok: boolean; error?: string }> => ({ ok: true })),
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.send } }],
  },
}));
vi.mock('../../app/window-manager', () => ({
  activateWorkspaceWindow: mocks.activateWorkspaceWindow,
}));
vi.mock('../tab-store', () => ({ getDockTabs: () => [] }));

import { activateDockTab } from '../tab-actions';

describe('activateDockTab', () => {
  beforeEach(() => {
    mocks.send.mockClear();
    mocks.activateWorkspaceWindow.mockReset();
    mocks.activateWorkspaceWindow.mockResolvedValue({ ok: true });
  });

  it('activates the owning workspace before sending the scoped tab command', async () => {
    await expect(activateDockTab('ws-1', 'terminal')).resolves.toBe(true);
    expect(mocks.activateWorkspaceWindow).toHaveBeenCalledWith('ws-1');
    expect(mocks.send).toHaveBeenCalledWith('dock:activate-tab', {
      workspaceId: 'ws-1',
      tabId: 'terminal',
    });
  });

  it('does not report success when the target workspace cannot be activated', async () => {
    mocks.activateWorkspaceWindow.mockResolvedValueOnce({ ok: false, error: 'window unavailable' });
    await expect(activateDockTab('ws-stale', 'terminal')).resolves.toBe(false);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
