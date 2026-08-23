import { describe, expect, it } from 'vitest';
import type { RendererCanvasPlugin } from '../types';
import {
  activateCanvasPlugins,
  deactivateCanvasPlugin,
  getRegisteredNavItems,
  getRegisteredNodeView,
  getRegisteredRoutes,
  isRendererPluginActivated,
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
});
