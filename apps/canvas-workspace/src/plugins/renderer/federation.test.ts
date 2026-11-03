import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RendererFederatedPluginSpec } from '../types';

const runtime = vi.hoisted(() => ({
  init: vi.fn(),
  registerRemotes: vi.fn(),
  loadRemote: vi.fn(),
}));

vi.mock('@module-federation/runtime', () => runtime);

const { syncFederatedRendererPlugins } = await import('./federation');
const { getRegisteredRoutes, isRendererPluginActivated } = await import('./registry');

const spec = (version: string): RendererFederatedPluginSpec => ({
  id: 'hot-demo',
  name: 'pulse_plugin_hot_demo',
  entry: `pulse-canvas://local/tmp/hot-demo/remoteEntry.js?v=${version}`,
  expose: './plugin',
  type: 'global',
});

let loads = 0;

beforeEach(() => {
  loads = 0;
  runtime.loadRemote.mockImplementation(async () => {
    loads += 1;
    const label = `load ${loads}`;
    return {
      default: {
        activate(ctx: { registerRoute: (path: string, component: () => string) => void }) {
          ctx.registerRoute('/plugin/hot-demo', () => label);
        },
      },
    };
  });
});

describe('federated renderer hot reload', () => {
  it('reloads a plugin only when its entry URL changes', async () => {
    await syncFederatedRendererPlugins([spec('1')]);
    await syncFederatedRendererPlugins([spec('1')]);

    expect(runtime.loadRemote).toHaveBeenCalledTimes(1);
    expect(runtime.registerRemotes).not.toHaveBeenCalled();

    await syncFederatedRendererPlugins([spec('2')]);

    expect(runtime.registerRemotes).toHaveBeenCalledWith(
      [expect.objectContaining({ name: 'pulse_plugin_hot_demo', entry: spec('2').entry })],
      { force: true },
    );
    expect(runtime.loadRemote).toHaveBeenCalledTimes(2);
    expect(isRendererPluginActivated('hot-demo')).toBe(true);
    const routes = getRegisteredRoutes().filter((route) => route.path === '/plugin/hot-demo');
    expect(routes).toHaveLength(1);
    expect((routes[0].Component as () => string)()).toBe('load 2');
  });

  it('deactivates a plugin that leaves the config', async () => {
    await syncFederatedRendererPlugins([]);

    expect(isRendererPluginActivated('hot-demo')).toBe(false);
  });
});
