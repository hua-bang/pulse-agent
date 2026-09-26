import { beforeEach, describe, expect, it, vi } from 'vitest';

const activateWorkspaceWindow = vi.hoisted(() => vi.fn());
const getCanvasWindow = vi.hoisted(() => vi.fn());
const evalInPage = vi.hoisted(() => vi.fn());

vi.mock('../../../plugins/main/webview-page-control/js-primitives', () => ({ evalInPage }));

import { executeHostRendererEval } from './host-renderer-execution';
import { setRuntimeWindowPort } from '../window-port';

describe('host renderer execution', () => {
  beforeEach(() => {
    setRuntimeWindowPort({ activateWorkspaceWindow, getCanvasWindow });
    activateWorkspaceWindow.mockReset();
    getCanvasWindow.mockReset();
    evalInPage.mockReset();
  });

  it('executes in the already-visible workspace without activating or navigating', async () => {
    const runner = {
      id: 101,
      executeJavaScript: vi.fn().mockResolvedValue({ routePath: '/', workspaceId: 'ws-1' }),
    };
    getCanvasWindow.mockReturnValue({ webContents: runner });
    evalInPage.mockResolvedValue({ ok: true, data: { value: { sent: true } } });

    const result = await executeHostRendererEval(
      { code: 'return { sent: true }', timeoutMs: 1_500 },
      { workspaceId: 'ws-1', actor: { kind: 'test' } },
    );

    expect(getCanvasWindow).toHaveBeenCalledOnce();
    expect(activateWorkspaceWindow).not.toHaveBeenCalled();
    expect(runner.executeJavaScript).toHaveBeenCalledOnce();
    expect(runner.executeJavaScript.mock.calls[0]?.[0]).toContain('window.location.hash');
    expect(runner.executeJavaScript.mock.calls[0]?.[0]).not.toContain('window.location.hash =');
    expect(evalInPage).toHaveBeenCalledWith(runner, 'return { sent: true }', 1_500);
    expect(result).toEqual({ action: 'host_renderer_eval', value: { sent: true } });
  });

  it('rejects execution when there is no live renderer without activating a workspace', async () => {
    getCanvasWindow.mockReturnValue(null);

    await expect(executeHostRendererEval(
      { code: 'return document.title' },
      { workspaceId: 'ws-missing', actor: { kind: 'test' } },
    )).rejects.toMatchObject({
      code: 'host_renderer_unavailable',
      message: 'Canvas renderer is unavailable',
    });
    expect(activateWorkspaceWindow).not.toHaveBeenCalled();
    expect(evalInPage).not.toHaveBeenCalled();
  });

  it('rejects a different visible workspace instead of navigating to the requested one', async () => {
    const runner = {
      id: 102,
      executeJavaScript: vi.fn().mockResolvedValue({ routePath: '/', workspaceId: 'ws-visible' }),
    };
    getCanvasWindow.mockReturnValue({ webContents: runner });

    await expect(executeHostRendererEval(
      { code: 'return document.title' },
      { workspaceId: 'ws-requested', actor: { kind: 'test' } },
    )).rejects.toMatchObject({
      code: 'host_renderer_unavailable',
      message: 'Canvas renderer is showing workspace ws-visible, not ws-requested.',
    });
    expect(activateWorkspaceWindow).not.toHaveBeenCalled();
    expect(evalInPage).not.toHaveBeenCalled();
  });

  it('allows explicit navigation, then rejects a second eval after leaving the workspace route', async () => {
    const runner = {
      id: 103,
      executeJavaScript: vi.fn()
        .mockResolvedValueOnce({ routePath: '/', workspaceId: 'ws-1' })
        .mockResolvedValueOnce({ routePath: '/settings', workspaceId: null }),
    };
    const code = "window.location.hash = '#/settings'; return window.location.hash";
    getCanvasWindow.mockReturnValue({ webContents: runner });
    evalInPage.mockResolvedValue({ ok: true, data: { value: '#/settings' } });

    await expect(executeHostRendererEval(
      { code },
      { workspaceId: 'ws-1', actor: { kind: 'test' } },
    )).resolves.toEqual({ action: 'host_renderer_eval', value: '#/settings' });
    await expect(executeHostRendererEval(
      { code: 'return document.title' },
      { workspaceId: 'ws-1', actor: { kind: 'test' } },
    )).rejects.toMatchObject({
      code: 'host_renderer_unavailable',
      message: 'Canvas renderer is showing route /settings, not workspace ws-1.',
    });

    expect(activateWorkspaceWindow).not.toHaveBeenCalled();
    expect(evalInPage).toHaveBeenCalledTimes(1);
    expect(evalInPage).toHaveBeenCalledWith(runner, code, 5_000);
  });
});
