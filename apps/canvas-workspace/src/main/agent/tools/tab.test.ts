import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tabs: [] as Array<Record<string, unknown>>,
  globalTabs: [] as Array<Record<string, unknown>>,
  activateDockTab: vi.fn(async () => true),
  activateGlobalDockTab: vi.fn(async () => true),
  openDockTab: vi.fn(() => true),
  execInSession: vi.fn(async () => ({ ok: true, output: 'tests passed' })),
  getWebContentsForDockTab: vi.fn(() => ({ id: 'global-link-webview' })),
  ensureOperable: vi.fn(async (options: { lookup: () => unknown }) => options.lookup()),
  readDOM: vi.fn(async () => ({
    ok: true,
    title: 'Global page',
    url: 'https://global.example/',
    text: 'Global page content',
  })),
}));

vi.mock('../../dock/tab-store', () => ({
  getDockTabs: () => mocks.tabs,
  getGlobalDockTabs: () => mocks.globalTabs,
}));
vi.mock('../../dock/tab-actions', () => ({
  activateDockTab: mocks.activateDockTab,
  activateGlobalDockTab: mocks.activateGlobalDockTab,
  findDockLinkTab: vi.fn(),
  openDockTab: mocks.openDockTab,
}));
vi.mock('../../terminal/pty-manager', () => ({
  execInSession: mocks.execInSession,
}));
vi.mock('../../terminal/scrollback', () => ({
  getSessionScrollback: vi.fn(),
}));
vi.mock('../../webview/registry', () => ({
  getWebContentsForDockTab: mocks.getWebContentsForDockTab,
  getWebContentsForNode: vi.fn(),
}));
vi.mock('../../webview/ensure-operable', () => ({ ensureOperable: mocks.ensureOperable }));
vi.mock('../../app/window-manager', () => ({ activateWorkspaceWindow: vi.fn() }));
vi.mock('../../webview/reader', () => ({
  readDOM: mocks.readDOM,
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
    mocks.activateGlobalDockTab.mockClear();
    mocks.openDockTab.mockClear();
    mocks.execInSession.mockClear();
    mocks.globalTabs = [
      {
        id: 'link:global',
        kind: 'link',
        scope: 'global',
        title: 'Global page',
        url: 'https://global.example/',
        dockWorkspaceId: 'mount-only-ws',
      },
    ];
  });

  it('preserves list and open tool output while routing through capabilities', async () => {
    const tools = createTabTools('ws-1');

    const listed = JSON.parse(await tools.canvas_list_tabs.execute({}));
    expect(listed).toMatchObject({ ok: true, count: 2, tabs: mocks.tabs });

    const opened = JSON.parse(await tools.canvas_open_tab.execute({
      url: 'https://example.com/docs',
    }));
    expect(opened).toMatchObject({ ok: true, url: 'https://example.com/docs' });
    expect(mocks.openDockTab).toHaveBeenCalledWith('https://example.com/docs', undefined);
  });

  it('lists, activates, reads, and opens a global Link Tab without workspaceId', async () => {
    const tools = createTabTools('');

    const listed = JSON.parse(await tools.canvas_list_tabs.execute({}));
    expect(listed).toEqual({
      ok: true,
      count: 1,
      tabs: [{
        id: 'link:global',
        kind: 'link',
        scope: 'global',
        title: 'Global page',
        url: 'https://global.example/',
      }],
    });

    const activated = JSON.parse(await tools.canvas_activate_tab.execute({ tabId: 'link:global' }));
    expect(activated).toMatchObject({ ok: true, tabId: 'link:global', kind: 'link' });
    expect(mocks.activateGlobalDockTab).toHaveBeenCalledWith('link:global');

    const read = JSON.parse(await tools.canvas_read_tab.execute({
      kind: 'link',
      tabId: 'link:global',
      strategy: 'dom',
    }));
    expect(read).toMatchObject({ ok: true, kind: 'link', strategy: 'dom', text: 'Global page content' });
    expect(mocks.getWebContentsForDockTab).toHaveBeenCalledWith('link:global');

    const opened = JSON.parse(await tools.canvas_open_tab.execute({ url: 'https://new.example/' }));
    expect(opened).toMatchObject({ ok: true, url: 'https://new.example/' });
    expect(mocks.openDockTab).toHaveBeenCalledWith('https://new.example/', undefined);
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

  it('requires an affirmative clarification before terminal execution in ask mode', async () => {
    const tools = createTabTools('ws-1');
    const onClarificationRequest = vi.fn(async () => 'no');
    const denied = JSON.parse(await tools.canvas_execute_terminal_tab.execute(
      { tabId: 'terminal:2', command: 'pnpm test' },
      { runContext: { executionMode: 'ask' }, onClarificationRequest },
    ));

    expect(onClarificationRequest).toHaveBeenCalledWith(expect.objectContaining({
      question: expect.stringContaining('pnpm test'),
      timeout: 0,
    }));
    expect(denied).toMatchObject({ ok: false, error: expect.stringContaining('not confirmed') });
    expect(mocks.execInSession).not.toHaveBeenCalled();

    onClarificationRequest.mockResolvedValueOnce('yes');
    const approved = JSON.parse(await tools.canvas_execute_terminal_tab.execute(
      { tabId: 'terminal:2', command: 'pnpm test' },
      { runContext: { executionMode: 'ask' }, onClarificationRequest },
    ));
    expect(approved).toMatchObject({ ok: true, output: 'tests passed' });
  });

  it('keeps the preview workspace id when routing a canvas tab read', async () => {
    const tools = createTabTools('ws-1');
    const parsed = tools.canvas_read_tab.inputSchema.parse({
      kind: 'canvas',
      workspaceId: 'ws-2',
    });
    const result = JSON.parse(await tools.canvas_read_tab.execute(parsed));
    expect(result).toMatchObject({
      ok: false,
      kind: 'canvas',
      error: expect.stringContaining('workspaceId: "ws-2"'),
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
