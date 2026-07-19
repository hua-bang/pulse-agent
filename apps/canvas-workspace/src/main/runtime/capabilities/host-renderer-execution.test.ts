import { beforeEach, describe, expect, it, vi } from 'vitest';

const activateWorkspaceWindow = vi.hoisted(() => vi.fn());
const getPublishedDockWorkspaceId = vi.hoisted(() => vi.fn());
const evalInPage = vi.hoisted(() => vi.fn());

vi.mock('../../app/window-manager', () => ({ activateWorkspaceWindow }));
vi.mock('../../dock/tab-store', () => ({ getPublishedDockWorkspaceId }));
vi.mock('../../../plugins/main/webview-page-control/js-primitives', () => ({ evalInPage }));

import { executeHostRendererEval } from './host-renderer-execution';

describe('host renderer execution', () => {
  beforeEach(() => {
    activateWorkspaceWindow.mockReset();
    getPublishedDockWorkspaceId.mockReset();
    evalInPage.mockReset();
  });

  it('waits for the selected workspace projection and executes in its host renderer', async () => {
    const runner = { id: 101, executeJavaScript: vi.fn() };
    activateWorkspaceWindow.mockResolvedValue({ ok: true, window: { webContents: runner } });
    getPublishedDockWorkspaceId.mockReturnValue('ws-1');
    evalInPage.mockResolvedValue({ ok: true, data: { value: { sent: true } } });

    const result = await executeHostRendererEval(
      { code: 'return { sent: true }', timeoutMs: 1_500 },
      { workspaceId: 'ws-1', actor: { kind: 'test' } },
    );

    expect(activateWorkspaceWindow).toHaveBeenCalledWith('ws-1');
    expect(getPublishedDockWorkspaceId).toHaveBeenCalledWith(101);
    expect(evalInPage).toHaveBeenCalledWith(runner, 'return { sent: true }', 1_500);
    expect(result).toEqual({ action: 'host_renderer_eval', value: { sent: true } });
  });

  it('rejects execution when the requested workspace cannot be activated', async () => {
    activateWorkspaceWindow.mockResolvedValue({ ok: false, error: 'window unavailable' });

    await expect(executeHostRendererEval(
      { code: 'return document.title' },
      { workspaceId: 'ws-missing', actor: { kind: 'test' } },
    )).rejects.toMatchObject({
      code: 'host_renderer_unavailable',
      message: 'window unavailable',
    });
    expect(evalInPage).not.toHaveBeenCalled();
  });
});
