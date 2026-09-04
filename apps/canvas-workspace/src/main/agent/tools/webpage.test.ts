import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  runtimeCall: vi.fn(),
  getWebContentsForNode: vi.fn(),
  findDockLinkTab: vi.fn(),
  ensureOperable: vi.fn(),
  activateWorkspaceWindow: vi.fn(),
  readDOMElement: vi.fn(),
}));

vi.mock('../../webview/registry', () => ({
  getWebContentsForNode: mocks.getWebContentsForNode,
}));
vi.mock('../../dock/tab-actions', () => ({
  findDockLinkTab: mocks.findDockLinkTab,
}));
vi.mock('../../webview/ensure-operable', () => ({
  ensureOperable: mocks.ensureOperable,
}));
vi.mock('../window-port', () => ({
  getAgentWindowPort: () => ({
    activateWorkspaceWindow: mocks.activateWorkspaceWindow,
    getCanvasWindow: () => null,
  }),
}));
vi.mock('../../webview/reader', () => ({
  readDOMElement: mocks.readDOMElement,
}));

vi.mock('../../runtime/capabilities', () => ({
  PAGE_READINESS_HINT: 'readiness hint',
  getCanvasCapabilityRuntime: () => ({ call: mocks.runtimeCall }),
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

import { createWebpageTools } from './webpage';

describe('browser_read_page capability adapter', () => {
  beforeEach(() => {
    mocks.runtimeCall.mockReset();
    mocks.getWebContentsForNode.mockReset();
    mocks.findDockLinkTab.mockReset();
    mocks.ensureOperable.mockReset();
    mocks.activateWorkspaceWindow.mockReset();
    mocks.readDOMElement.mockReset();
  });

  it('preserves the legacy success payload', async () => {
    mocks.runtimeCall.mockResolvedValue({
      ok: true,
      value: {
        strategy: 'dom',
        title: 'Fixture',
        url: 'https://example.test/',
        text: 'hello',
        textLength: 5,
        hint: 'readiness hint',
      },
    });

    const output = JSON.parse(await createWebpageTools('ws-1').browser_read_page.execute({
      nodeId: 'web-1',
      strategy: 'dom',
    }));
    expect(output).toEqual({
      ok: true,
      strategy: 'dom',
      title: 'Fixture',
      url: 'https://example.test/',
      text: 'hello',
      textLength: 5,
      hint: 'readiness hint',
    });
    expect(mocks.runtimeCall).toHaveBeenCalledWith(
      'browser.page.read',
      { nodeId: 'web-1', strategy: 'dom' },
      expect.objectContaining({ workspaceId: 'ws-1' }),
    );
  });

  it('uses the legacy workspace override without leaking it into capability input', async () => {
    mocks.runtimeCall.mockResolvedValue({ ok: true, value: { strategy: 'dom', text: '' } });

    await createWebpageTools('ws-1').browser_read_page.execute({
      nodeId: 'web-1',
      workspaceId: 'ws-2',
      strategy: 'dom',
    });

    expect(mocks.runtimeCall).toHaveBeenCalledWith(
      'browser.page.read',
      { nodeId: 'web-1', strategy: 'dom' },
      expect.objectContaining({ workspaceId: 'ws-2' }),
    );
  });

  it('preserves strategy on read failures', async () => {
    mocks.runtimeCall.mockResolvedValue({
      ok: false,
      error: {
        code: 'page_read_failed',
        message: 'DOM extraction timed out',
        details: { strategy: 'dom' },
      },
    });

    const output = JSON.parse(await createWebpageTools('ws-1').browser_read_page.execute({
      nodeId: 'web-1',
      strategy: 'dom',
    }));
    expect(output).toEqual({
      ok: false,
      strategy: 'dom',
      error: 'DOM extraction timed out',
    });
  });
});

describe('browser_read_dom_selection', () => {
  it('does not activate a workspace when a dock tab guest is temporarily unavailable', async () => {
    // The tab can be stale in the current published tab list while its
    // selection context is still being processed.
    mocks.findDockLinkTab.mockReturnValue(undefined);
    mocks.getWebContentsForNode.mockReturnValue(null);
    mocks.ensureOperable.mockImplementation(async (options: { activate: () => Promise<unknown> }) => {
      await options.activate();
      return null;
    });

    const output = JSON.parse(await createWebpageTools('ws-1').browser_read_dom_selection.execute({
      nodeId: 'link:youtube',
      selector: '#video',
    }));

    expect(output.ok).toBe(false);
    expect(mocks.activateWorkspaceWindow).not.toHaveBeenCalled();
    expect(mocks.ensureOperable).not.toHaveBeenCalled();
  });
});
