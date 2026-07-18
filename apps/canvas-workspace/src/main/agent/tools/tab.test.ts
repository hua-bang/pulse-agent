import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tabs: [] as Array<Record<string, unknown>>,
  activateDockTab: vi.fn(() => true),
  execInSession: vi.fn(async () => ({ ok: true, output: 'tests passed' })),
}));

vi.mock('../../dock/tab-store', () => ({
  getDockTabs: () => mocks.tabs,
}));
vi.mock('../../dock/tab-actions', () => ({
  activateDockTab: mocks.activateDockTab,
  findDockLinkTab: vi.fn(),
  openDockTab: vi.fn(),
}));
vi.mock('../../terminal/pty-manager', () => ({
  execInSession: mocks.execInSession,
}));
vi.mock('../../terminal/scrollback', () => ({
  getSessionScrollback: vi.fn(),
}));
vi.mock('../../webview/registry', () => ({ getWebContentsForNode: vi.fn() }));
vi.mock('../../webview/ensure-operable', () => ({ ensureOperable: vi.fn() }));
vi.mock('../../app/window-manager', () => ({ activateWorkspaceWindow: vi.fn() }));
vi.mock('../../webview/reader', () => ({
  readDOM: vi.fn(),
  readA11y: vi.fn(),
  captureScreenshot: vi.fn(),
}));
vi.mock('../../artifacts/store', () => ({ getCurrentVersionContent: vi.fn() }));
vi.mock('../../dock/history-store', () => ({ searchHistory: vi.fn() }));

import { createTabTools } from './tab';

describe('dock tab interaction tools', () => {
  beforeEach(() => {
    mocks.tabs = [
      { id: 'canvas:ws-2', kind: 'canvas', title: 'Research', workspaceId: 'ws-2' },
      {
        id: 'terminal:2',
        kind: 'terminal',
        title: 'Build',
        workspaceId: 'ws-1',
        sessionId: 'workspace-terminal:ws-1:terminal:2',
      },
    ];
    mocks.activateDockTab.mockClear();
    mocks.execInSession.mockClear();
  });

  it('activates a listed tab and rejects stale tab ids', async () => {
    const tools = createTabTools('ws-1');

    expect(JSON.parse(await tools.canvas_activate_tab.execute({ tabId: 'canvas:ws-2' }))).toMatchObject({
      ok: true,
      tabId: 'canvas:ws-2',
      kind: 'canvas',
    });
    expect(mocks.activateDockTab).toHaveBeenCalledWith('ws-1', 'canvas:ws-2');

    const stale = JSON.parse(await tools.canvas_activate_tab.execute({ tabId: 'missing' }));
    expect(stale).toMatchObject({ ok: false, error: expect.stringContaining('not open') });
    expect(mocks.activateDockTab).toHaveBeenCalledTimes(1);
  });

  it('executes a command in the PTY session owned by a listed terminal tab', async () => {
    const tools = createTabTools('ws-1');
    const result = JSON.parse(await tools.canvas_execute_terminal_tab.execute({
      tabId: 'terminal:2',
      command: 'pnpm test',
      timeoutMs: 45_000,
    }));

    expect(mocks.execInSession).toHaveBeenCalledWith(
      'workspace-terminal:ws-1:terminal:2',
      'pnpm test',
      { timeout: 45_000 },
    );
    expect(result).toEqual({
      ok: true,
      kind: 'terminal',
      tabId: 'terminal:2',
      output: 'tests passed',
    });
  });

  it('does not execute against a non-terminal or stale tab', async () => {
    const tools = createTabTools('ws-1');

    const wrongKind = JSON.parse(await tools.canvas_execute_terminal_tab.execute({
      tabId: 'canvas:ws-2',
      command: 'pwd',
    }));
    expect(wrongKind).toMatchObject({ ok: false, error: expect.stringContaining('not a terminal') });

    const stale = JSON.parse(await tools.canvas_execute_terminal_tab.execute({
      tabId: 'missing',
      command: 'pwd',
    }));
    expect(stale).toMatchObject({ ok: false, error: expect.stringContaining('not open') });
    expect(mocks.execInSession).not.toHaveBeenCalled();
  });
});
