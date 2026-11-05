import { describe, expect, it, vi } from 'vitest';
import type { RendererCanvasPlugin } from '../types';
import {
  activateCanvasPlugins,
  deactivateCanvasPlugin,
  getRegisteredNavItems,
  getRegisteredNodeView,
  getRegisteredRoutes,
  isRendererPluginActivated,
  setPluginChatTextHandler,
} from './registry';

describe('renderer plugin lifecycle', () => {
  it('removes owned registrations and allows the same plugin id to reactivate', () => {
    const plugin: RendererCanvasPlugin = {
      id: 'lifecycle-test-plugin',
      activate: (ctx) => {
        ctx.registerRoute('/lifecycle-test', () => null);
        ctx.registerNavItem({ id: 'lifecycle-test-nav', label: 'Lifecycle', path: '/lifecycle-test' });
        ctx.registerNodeView('lifecycle-test-node', () => null);
      },
    };

    activateCanvasPlugins([plugin]);
    expect(isRendererPluginActivated(plugin.id)).toBe(true);
    expect(getRegisteredRoutes().some((entry) => entry.pluginId === plugin.id)).toBe(true);
    expect(getRegisteredNavItems().some((entry) => entry.id === 'lifecycle-test-nav')).toBe(true);
    expect(getRegisteredNodeView('lifecycle-test-node')?.pluginId).toBe(plugin.id);

    expect(deactivateCanvasPlugin(plugin.id)).toBe(true);
    expect(isRendererPluginActivated(plugin.id)).toBe(false);
    expect(getRegisteredRoutes().some((entry) => entry.pluginId === plugin.id)).toBe(false);
    expect(getRegisteredNavItems().some((entry) => entry.id === 'lifecycle-test-nav')).toBe(false);
    expect(getRegisteredNodeView('lifecycle-test-node')).toBeUndefined();

    activateCanvasPlugins([plugin]);
    expect(isRendererPluginActivated(plugin.id)).toBe(true);
    expect(getRegisteredRoutes().filter((entry) => entry.pluginId === plugin.id)).toHaveLength(1);
    deactivateCanvasPlugin(plugin.id);
  });

  it('rolls back partial registrations when activation fails', () => {
    const plugin: RendererCanvasPlugin = {
      id: 'lifecycle-failure-plugin',
      activate: (ctx) => {
        ctx.registerRoute('/lifecycle-failure', () => null);
        ctx.registerNodeView('lifecycle-failure-node', () => null);
        throw new Error('activation failed');
      },
    };
    const error = console.error;
    console.error = () => undefined;
    try {
      activateCanvasPlugins([plugin]);
    } finally {
      console.error = error;
    }

    expect(isRendererPluginActivated(plugin.id)).toBe(false);
    expect(getRegisteredRoutes().some((entry) => entry.pluginId === plugin.id)).toBe(false);
    expect(getRegisteredNodeView('lifecycle-failure-node')).toBeUndefined();
  });

  it('routes addTextToChat through the host handler', async () => {
    let ctxRef: Parameters<RendererCanvasPlugin['activate']>[0] | null = null;
    const plugin: RendererCanvasPlugin = {
      id: 'chat-text-test-plugin',
      activate: (ctx) => { ctxRef = ctx; },
    };
    activateCanvasPlugins([plugin]);

    await expect(ctxRef!.addTextToChat('quote')).resolves.toBe('unavailable');

    const handler = vi.fn(async () => 'delivered' as const);
    setPluginChatTextHandler(handler);
    await expect(ctxRef!.addTextToChat('quote')).resolves.toBe('delivered');
    await expect(ctxRef!.addTextToChat('   ')).resolves.toBe('unavailable');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('quote');

    setPluginChatTextHandler(null);
    deactivateCanvasPlugin(plugin.id);
  });

  it('reads only the plugin\'s own web views through the host bridge', async () => {
    let ctxRef: Parameters<RendererCanvasPlugin['activate']>[0] | null = null;
    const plugin: RendererCanvasPlugin = {
      id: 'weread',
      activate: (ctx) => { ctxRef = ctx; },
    };
    const read = vi.fn(async () => ({ ok: false, nodeId: '', strategy: 'dom', error: 'x' }));
    const readSelection = vi.fn(async () => ({ ok: false, nodeId: '', error: 'x' }));
    vi.stubGlobal('canvasWorkspace', { web: { read, readSelection } });
    try {
      activateCanvasPlugins([plugin]);
      expect(ctxRef!.WebView.displayName).toBe('PluginWebView(weread)');

      await ctxRef!.readSelection();
      await ctxRef!.readPage('reader', { maxChars: 100 });
      expect(readSelection).toHaveBeenCalledWith({
        workspaceId: '__plugin-pages__',
        nodeId: 'plugin:weread/main',
        maxChars: undefined,
      });
      expect(read).toHaveBeenCalledWith({
        workspaceId: '__plugin-pages__',
        nodeId: 'plugin:weread/reader',
        strategy: 'dom',
        maxChars: 100,
      });
    } finally {
      vi.unstubAllGlobals();
      deactivateCanvasPlugin(plugin.id);
    }
  });
});
