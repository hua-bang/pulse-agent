import { describe, expect, it, vi } from 'vitest';

const defaults = vi.hoisted(() => ({
  activateWorkspaceWindow: vi.fn(),
  ensureOperable: vi.fn(),
  getWebContentsForNode: vi.fn((_workspaceId: string, _nodeId: string): unknown => null),
  readDOM: vi.fn(),
  readSelection: vi.fn(),
}));

vi.mock('../../webview/registry', () => ({ getWebContentsForNode: defaults.getWebContentsForNode }));
vi.mock('../../webview/ensure-operable', () => ({ ensureOperable: defaults.ensureOperable }));
vi.mock('../../dock/tab-actions', () => ({ findDockLinkTab: () => undefined }));
vi.mock('../../webview/reader', () => ({
  readA11y: vi.fn(),
  readDOM: defaults.readDOM,
  captureScreenshot: vi.fn(),
}));
vi.mock('../../webview/selection/read-selection', () => ({ readSelection: defaults.readSelection }));

import { CapabilityRuntime } from './runtime';
import { createPageCapabilities } from './page-capabilities';
import { setCanvasWindowPort } from '../../agent/window-port';

describe('Page capabilities', () => {
  it('uses the runtime window port when the default live reader activates a missing node', async () => {
    defaults.activateWorkspaceWindow.mockResolvedValue({ ok: true });
    defaults.ensureOperable.mockImplementation(async (options: {
      activate: () => Promise<unknown>;
      mode: string;
    }) => {
      expect(options.mode).toBe('read');
      await options.activate();
      return null;
    });
    setCanvasWindowPort({
      getFocusedCanvasWindow: () => null,
      getLiveCanvasWindow: () => null,
      activateWorkspaceWindow: defaults.activateWorkspaceWindow,
    });
    const runtime = new CapabilityRuntime(createPageCapabilities());

    await expect(runtime.call(
      'browser.page.read',
      { nodeId: 'web-1', strategy: 'dom' },
      { workspaceId: 'ws-1', actor: { kind: 'test' } },
    )).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'webview_not_found',
        message: expect.stringContaining('auto-activation attempted'),
      },
    });
    expect(defaults.activateWorkspaceWindow).toHaveBeenCalledWith('ws-1');
  });

  it('reads a live page with workspace context through the public runtime seam', async () => {
    const readPage = vi.fn().mockResolvedValue({
      strategy: 'dom',
      title: 'Runtime fixture',
      url: 'https://example.test/',
      text: 'hello',
      textLength: 5,
      hint: 'verify readiness',
    });
    const runtime = new CapabilityRuntime(createPageCapabilities({
      readPage,
      clickPage: vi.fn(),
      fillPage: vi.fn(),
      evalPage: vi.fn(),
    }));

    await expect(runtime.call(
      'browser.page.read',
      { nodeId: 'web-1', strategy: 'dom' },
      { workspaceId: 'ws-1', actor: { kind: 'test' } },
    )).resolves.toEqual({
      ok: true,
      value: {
        strategy: 'dom',
        title: 'Runtime fixture',
        url: 'https://example.test/',
        text: 'hello',
        textLength: 5,
        hint: 'verify readiness',
      },
    });
    expect(readPage).toHaveBeenCalledWith('ws-1', {
      nodeId: 'web-1',
      strategy: 'dom',
    });
  });

  it('exposes structured click and fill schemas and delegates validated actions', async () => {
    const clickPage = vi.fn().mockResolvedValue({
      action: 'page_click',
      url: 'https://example.test/',
      selector: '#submit',
    });
    const fillPage = vi.fn().mockResolvedValue({
      action: 'page_fill',
      url: 'https://example.test/',
      selector: '#name',
      value: 'Pulse',
    });
    const runtime = new CapabilityRuntime(createPageCapabilities({
      readPage: vi.fn(),
      clickPage,
      fillPage,
      evalPage: vi.fn(),
    }));
    const context = { workspaceId: 'ws-1', actor: { kind: 'test' as const } };

    await expect(runtime.call(
      'browser.page.click',
      { nodeId: 'web-1', selector: '#submit' },
      context,
    )).resolves.toMatchObject({ ok: true, value: { action: 'page_click' } });
    await expect(runtime.call(
      'browser.page.fill',
      { nodeId: 'web-1', selector: '#name', value: 'Pulse' },
      context,
    )).resolves.toMatchObject({ ok: true, value: { action: 'page_fill' } });

    expect(clickPage).toHaveBeenCalledWith('ws-1', {
      nodeId: 'web-1',
      selector: '#submit',
    });
    expect(fillPage).toHaveBeenCalledWith('ws-1', {
      nodeId: 'web-1',
      selector: '#name',
      value: 'Pulse',
    });
    expect(runtime.list({ kind: 'test' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'browser.page.click', risk: 'operate' }),
      expect.objectContaining({ name: 'browser.page.fill', risk: 'operate' }),
    ]));
  });

  it('lets the Canvas Agent execute unsafe page scripts through the runtime seam', async () => {
    const evalPage = vi.fn().mockResolvedValue({
      action: 'page_eval',
      url: 'https://example.test/',
      value: { count: 3 },
    });
    const runtime = new CapabilityRuntime(createPageCapabilities({
      readPage: vi.fn(),
      clickPage: vi.fn(),
      fillPage: vi.fn(),
      evalPage,
    }));

    expect(runtime.list({ kind: 'canvas-agent' })).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'browser.page.eval', risk: 'unsafe' }),
    ]));
    await expect(runtime.call(
      'browser.page.eval',
      { nodeId: 'web-1', code: 'return { count: document.links.length }', timeoutMs: 2_000 },
      { workspaceId: 'ws-1', actor: { kind: 'canvas-agent' } },
    )).resolves.toEqual({
      ok: true,
      value: {
        action: 'page_eval',
        url: 'https://example.test/',
        value: { count: 3 },
      },
    });
    expect(evalPage).toHaveBeenCalledWith('ws-1', {
      nodeId: 'web-1',
      code: 'return { count: document.links.length }',
      timeoutMs: 2_000,
    });
  });

  it('can hide operate capabilities when webview page control is disabled', () => {
    const runtime = new CapabilityRuntime(createPageCapabilities({
      readPage: vi.fn(),
      clickPage: vi.fn(),
      fillPage: vi.fn(),
      evalPage: vi.fn(),
    }, { includePageControl: false }));

    expect(runtime.list({ kind: 'pulse-cli' }).map(({ name }) => name)).toEqual([
      'browser.page.read',
      'browser.page.selection',
    ]);
  });

  it('reads plugin pages from the plugin workspace without activating a canvas', async () => {
    const pluginWc = { id: 7 };
    defaults.ensureOperable.mockReset();
    defaults.getWebContentsForNode.mockImplementation((workspaceId, nodeId) => (
      workspaceId === '__plugin-pages__' && nodeId === 'plugin:weread/main' ? pluginWc : null
    ));
    defaults.readDOM.mockResolvedValue({ ok: true, title: 'Book', url: 'https://weread.test/', text: 'chapter text' });
    defaults.readSelection.mockResolvedValue({
      ok: true,
      selection: { text: 'quoted line', before: 'a ', after: ' b', truncated: false, title: 'Book', url: 'https://weread.test/' },
    });
    const runtime = new CapabilityRuntime(createPageCapabilities());
    const context = { workspaceId: 'ws-1', actor: { kind: 'pulse-cli' as const } };

    await expect(runtime.call('browser.page.read', { nodeId: 'plugin:weread/main', strategy: 'dom' }, context))
      .resolves.toMatchObject({ ok: true, value: { strategy: 'dom', text: 'chapter text' } });
    await expect(runtime.call('browser.page.selection', { nodeId: 'plugin:weread/main' }, context))
      .resolves.toEqual({
        ok: true,
        value: {
          text: 'quoted line',
          before: 'a ',
          after: ' b',
          truncated: false,
          title: 'Book',
          url: 'https://weread.test/',
          hasSelection: true,
        },
      });
    expect(defaults.readSelection).toHaveBeenCalledWith(pluginWc, undefined);

    await expect(runtime.call('browser.page.selection', { nodeId: 'plugin:other/main' }, context))
      .resolves.toMatchObject({
        ok: false,
        error: { code: 'webview_not_found', message: expect.stringContaining('Plugin page plugin:other/main is not open') },
      });
    expect(defaults.ensureOperable).not.toHaveBeenCalled();
    defaults.getWebContentsForNode.mockReset().mockReturnValue(null);
  });
});
