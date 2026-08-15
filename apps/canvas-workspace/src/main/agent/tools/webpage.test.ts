import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtimeCall = vi.hoisted(() => vi.fn());
const getGlobalWebContents = vi.hoisted(() => vi.fn());
const getNodeWebContents = vi.hoisted(() => vi.fn());
const ensureOperable = vi.hoisted(() => vi.fn());
const activateGlobalDockTab = vi.hoisted(() => vi.fn());
const activateWorkspaceWindow = vi.hoisted(() => vi.fn());
const readDOMElement = vi.hoisted(() => vi.fn());

vi.mock('../../runtime/capabilities', () => ({
  PAGE_READINESS_HINT: 'readiness hint',
  getCanvasCapabilityRuntime: () => ({ call: runtimeCall }),
}));
vi.mock('../../webview/registry', () => ({
  getWebContentsForDockTab: getGlobalWebContents,
  getWebContentsForNode: getNodeWebContents,
}));
vi.mock('../../webview/ensure-operable', () => ({
  ensureOperable,
}));
vi.mock('../../dock/tab-actions', () => ({
  activateGlobalDockTab,
}));
vi.mock('../../app/window-manager', () => ({
  activateWorkspaceWindow,
}));
vi.mock('../../webview/reader', () => ({
  readDOMElement,
}));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }));

import { createWebpageTools } from './webpage';

describe('canvas_read_webpage capability adapter', () => {
  beforeEach(() => {
    runtimeCall.mockReset();
    getGlobalWebContents.mockReset();
    getNodeWebContents.mockReset();
    ensureOperable.mockReset();
    activateGlobalDockTab.mockReset();
    activateWorkspaceWindow.mockReset();
    readDOMElement.mockReset();
  });

  it('preserves the legacy success payload', async () => {
    runtimeCall.mockResolvedValue({
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

    const output = JSON.parse(await createWebpageTools('ws-1').canvas_read_webpage.execute({
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
    expect(runtimeCall).toHaveBeenCalledWith(
      'browser.page.read',
      { nodeId: 'web-1', strategy: 'dom' },
      expect.objectContaining({ workspaceId: 'ws-1' }),
    );
  });

  it('uses the legacy workspace override without leaking it into capability input', async () => {
    runtimeCall.mockResolvedValue({ ok: true, value: { strategy: 'dom', text: '' } });

    await createWebpageTools('ws-1').canvas_read_webpage.execute({
      nodeId: 'web-1',
      workspaceId: 'ws-2',
      strategy: 'dom',
    });

    expect(runtimeCall).toHaveBeenCalledWith(
      'browser.page.read',
      { nodeId: 'web-1', strategy: 'dom' },
      expect.objectContaining({ workspaceId: 'ws-2' }),
    );
  });

  it('preserves strategy on read failures', async () => {
    runtimeCall.mockResolvedValue({
      ok: false,
      error: {
        code: 'page_read_failed',
        message: 'DOM extraction timed out',
        details: { strategy: 'dom' },
      },
    });

    const output = JSON.parse(await createWebpageTools('ws-1').canvas_read_webpage.execute({
      nodeId: 'web-1',
      strategy: 'dom',
    }));
    expect(output).toEqual({
      ok: false,
      strategy: 'dom',
      error: 'DOM extraction timed out',
    });
  });

  it('reads a selected element from a global Link Tab without workspaceId', async () => {
    const webContents = { id: 42 };
    getGlobalWebContents.mockReturnValue(webContents);
    ensureOperable.mockImplementation(async (options: { lookup: () => unknown }) => options.lookup());
    readDOMElement.mockResolvedValue({
      ok: true,
      title: 'Global page',
      url: 'https://example.test/page',
      selector: '#main',
      tagName: 'main',
      rect: { x: 0, y: 0, width: 100, height: 50 },
      text: 'Selected content',
      html: '<main>Selected content</main>',
      htmlPreview: '<main>Selected content</main>',
      tree: { tagName: 'main' },
      controls: [],
      accessibility: {},
      snapshot: { nodeCount: 1, controlCount: 0, truncated: false },
    });

    const output = JSON.parse(await createWebpageTools('').canvas_read_dom_selection.execute({
      nodeId: 'tab-global',
      selector: '#main',
    }));

    expect(output).toMatchObject({
      ok: true,
      strategy: 'dom-selection',
      title: 'Global page',
      text: 'Selected content',
    });
    expect(getGlobalWebContents).toHaveBeenCalledWith('tab-global');
    expect(getNodeWebContents).not.toHaveBeenCalled();
    expect(activateGlobalDockTab).not.toHaveBeenCalled();
    expect(readDOMElement).toHaveBeenCalledWith(webContents, '#main', 12_000);
  });
});
