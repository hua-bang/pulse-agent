/**
 * Plugin registry — focused on registered tools, node capabilities, and
 * plugin-scoped IPC handler lifecycle. These tests prove that:
 *
 *   - `enabledWhen: () => false` plugins do NOT contribute tools.
 *   - `enabledWhen: () => true` plugins DO, and their factory receives
 *     the right `workspaceId` for each canvas-agent.
 *   - Multiple plugins compose; the latest registration with a given
 *     plugin id overwrites the previous one.
 *   - Deactivation and failed activation remove only that plugin's IPC
 *     handlers, so enabling the same id again does not collide.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { MainCanvasPlugin } from '../../types';

const electronFakes = vi.hoisted(() => {
  const activeChannels = new Set<string>();
  return {
    activeChannels,
    handle: vi.fn((channel: string) => {
      if (activeChannels.has(channel)) {
        throw new Error(`Attempted to register a second handler for ${channel}`);
      }
      activeChannels.add(channel);
    }),
    removeHandler: vi.fn((channel: string) => {
      activeChannels.delete(channel);
    }),
  };
});

// Stub `electron` BEFORE importing the registry. We need `ipcMain.handle`
// (for the plugin handle bridge), and `app.getPath` (used by
// `createPluginStore` to pick a userData directory). Tests don't touch
// the store, but `createMainCtx` builds one eagerly and it would throw
// without `app.getPath`. `vi.mock` is hoisted above imports, so the
// factory closure must not capture any test-file constants.
vi.mock('electron', () => ({
  ipcMain: {
    handle: electronFakes.handle,
    removeHandler: electronFakes.removeHandler,
  },
  app: {
    getPath: () => '/tmp/canvas-plugins-registry-test',
  },
}));

// Reset the registry module between tests so its module-local registries are
// fresh — there's no public clear() API, and we don't want to add one just
// for tests.
async function loadRegistry() {
  vi.resetModules();
  return await import('../registry');
}

describe('setupCanvasPlugins + registerCanvasTool', () => {
  beforeEach(() => {
    vi.resetModules();
    electronFakes.activeChannels.clear();
    electronFakes.handle.mockClear();
    electronFakes.removeHandler.mockClear();
  });

  it('plugin with enabledWhen=false does not get its tools registered', async () => {
    const { setupCanvasPlugins, getRegisteredCanvasToolFactories } = await loadRegistry();
    const factory = vi.fn();
    await setupCanvasPlugins([
      {
        id: 'p-off',
        enabledWhen: () => false,
        activate(ctx) {
          ctx.registerCanvasTool(factory);
        },
      },
    ]);
    expect(getRegisteredCanvasToolFactories()).toHaveLength(0);
    expect(factory).not.toHaveBeenCalled();
  });

  it('plugin with enabledWhen=true registers its factory; factory is called per workspace', async () => {
    const { setupCanvasPlugins, getRegisteredCanvasToolFactories } = await loadRegistry();
    const factory = vi.fn((workspaceId: string) => ({
      [`tool_${workspaceId}`]: { name: `tool_${workspaceId}`, _w: workspaceId },
    }));
    await setupCanvasPlugins([
      {
        id: 'p-on',
        enabledWhen: () => true,
        activate(ctx) {
          ctx.registerCanvasTool(factory);
        },
      },
    ]);
    const entries = getRegisteredCanvasToolFactories();
    expect(entries).toHaveLength(1);
    expect(entries[0][0]).toBe('p-on');

    // Caller (mimicking createCanvasTools) invokes the factory per workspace.
    const wsA = entries[0][1]('workspace-A');
    const wsB = entries[0][1]('workspace-B');
    expect(wsA).toHaveProperty('tool_workspace-A');
    expect(wsB).toHaveProperty('tool_workspace-B');
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it('plugin without enabledWhen activates by default (back-compat)', async () => {
    const { setupCanvasPlugins, getRegisteredCanvasToolFactories } = await loadRegistry();
    await setupCanvasPlugins([
      {
        id: 'p-default',
        activate(ctx) {
          ctx.registerCanvasTool(() => ({ tool_default: { name: 'tool_default' } }));
        },
      },
    ]);
    expect(getRegisteredCanvasToolFactories()).toHaveLength(1);
  });

  it('multiple plugins compose; each gets its own slot in the registry', async () => {
    const { setupCanvasPlugins, getRegisteredCanvasToolFactories } = await loadRegistry();
    await setupCanvasPlugins([
      {
        id: 'p-a',
        activate(ctx) {
          ctx.registerCanvasTool(() => ({ tool_a: { name: 'tool_a' } }));
        },
      },
      {
        id: 'p-b',
        activate(ctx) {
          ctx.registerCanvasTool(() => ({ tool_b: { name: 'tool_b' } }));
        },
      },
    ]);
    const entries = getRegisteredCanvasToolFactories();
    expect(entries.map(([id]) => id).sort()).toEqual(['p-a', 'p-b']);
  });

  it('duplicate plugin id is skipped (loaded-set guards re-activation)', async () => {
    const { setupCanvasPlugins, getRegisteredCanvasToolFactories } = await loadRegistry();
    const factoryA = vi.fn(() => ({ tool_a: { name: 'first' } }));
    const factoryB = vi.fn(() => ({ tool_b: { name: 'second' } }));
    await setupCanvasPlugins([
      { id: 'p-dup', activate(ctx) { ctx.registerCanvasTool(factoryA); } },
      { id: 'p-dup', activate(ctx) { ctx.registerCanvasTool(factoryB); } },
    ]);
    const entries = getRegisteredCanvasToolFactories();
    expect(entries).toHaveLength(1);
    // The duplicate's activate never ran, so factoryB was never registered.
    expect(entries[0][1]('ws')).toEqual({ tool_a: { name: 'first' } });
  });

  it('activate failure does not break registration of subsequent plugins', async () => {
    const { setupCanvasPlugins, getRegisteredCanvasToolFactories } = await loadRegistry();
    // Silence the expected console.error for this scenario.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await setupCanvasPlugins([
      {
        id: 'p-throws',
        activate() {
          throw new Error('boom');
        },
      },
      {
        id: 'p-ok',
        activate(ctx) {
          ctx.registerCanvasTool(() => ({ tool_ok: { name: 'ok' } }));
        },
      },
    ]);
    const entries = getRegisteredCanvasToolFactories();
    expect(entries.map(([id]) => id)).toEqual(['p-ok']);
    errSpy.mockRestore();
  });

  it('registers main-side plugin node capabilities by node type', async () => {
    const {
      setupCanvasPlugins,
      getRegisteredNodeCapability,
      getRegisteredNodeCapabilities,
    } = await loadRegistry();

    await setupCanvasPlugins([
      {
        id: 'p-node',
        activate(ctx) {
          ctx.registerNodeCapabilities('demo.card', {
            read: () => ({ content: 'hello' }),
          });
        },
      },
    ]);

    const entry = getRegisteredNodeCapability('demo.card');
    expect(entry?.pluginId).toBe('p-node');
    expect(entry?.nodeType).toBe('demo.card');
    expect(getRegisteredNodeCapabilities()).toHaveLength(1);
  });

  it('deactivates plugin registrations by plugin id', async () => {
    const {
      deactivateCanvasPlugin,
      setupCanvasPlugins,
      getRegisteredCanvasToolFactories,
      getRegisteredNodeCapability,
    } = await loadRegistry();
    const deactivate = vi.fn();

    await setupCanvasPlugins([
      {
        id: 'p-dynamic',
        activate(ctx) {
          ctx.registerCanvasTool(() => ({ tool_dynamic: { name: 'tool_dynamic' } }));
          ctx.registerNodeCapabilities('demo.dynamic', {
            read: () => ({ content: 'dynamic' }),
          });
        },
        deactivate,
      },
    ]);

    expect(getRegisteredCanvasToolFactories()).toHaveLength(1);
    expect(getRegisteredNodeCapability('demo.dynamic')?.pluginId).toBe('p-dynamic');

    await deactivateCanvasPlugin('p-dynamic');

    expect(deactivate).toHaveBeenCalledTimes(1);
    expect(getRegisteredCanvasToolFactories()).toEqual([]);
    expect(getRegisteredNodeCapability('demo.dynamic')).toBeUndefined();
  });

  it('removes IPC handlers on deactivation so the same plugin id can be enabled again', async () => {
    const { deactivateCanvasPlugin, setupCanvasPlugins } = await loadRegistry();
    const plugin: MainCanvasPlugin = {
      id: 'p-ipc-reload',
      activate(ctx) {
        ctx.handle('ping', () => 'pong');
      },
    };
    const otherPlugin: MainCanvasPlugin = {
      id: 'p-ipc-other',
      activate(ctx) {
        ctx.handle('ping', () => 'other-pong');
      },
    };

    await expect(setupCanvasPlugins([plugin, otherPlugin])).resolves.toEqual([
      'p-ipc-reload',
      'p-ipc-other',
    ]);
    expect(electronFakes.activeChannels).toEqual(new Set([
      'plugin:p-ipc-reload:ping',
      'plugin:p-ipc-other:ping',
    ]));

    await deactivateCanvasPlugin('p-ipc-reload');

    expect(electronFakes.removeHandler).toHaveBeenCalledWith('plugin:p-ipc-reload:ping');
    expect(electronFakes.removeHandler).not.toHaveBeenCalledWith('plugin:p-ipc-other:ping');
    expect(electronFakes.activeChannels).toEqual(new Set(['plugin:p-ipc-other:ping']));
    await expect(setupCanvasPlugins([plugin])).resolves.toEqual(['p-ipc-reload']);
    expect(electronFakes.handle).toHaveBeenCalledTimes(3);
  });

  it('rolls back IPC handlers when plugin activation fails', async () => {
    const { setupCanvasPlugins } = await loadRegistry();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(setupCanvasPlugins([
      {
        id: 'p-ipc-failure',
        activate(ctx) {
          ctx.handle('partial', () => 'registered-before-failure');
          ctx.handle('second-partial', () => 'also-registered-before-failure');
          throw new Error('boom');
        },
      },
    ])).resolves.toEqual([]);

    expect(electronFakes.removeHandler).toHaveBeenCalledWith('plugin:p-ipc-failure:partial');
    expect(electronFakes.removeHandler).toHaveBeenCalledWith('plugin:p-ipc-failure:second-partial');
    expect(electronFakes.activeChannels).toEqual(new Set());
    await expect(setupCanvasPlugins([
      {
        id: 'p-ipc-failure',
        activate(ctx) {
          ctx.handle('partial', () => 'registered-after-retry');
        },
      },
    ])).resolves.toEqual(['p-ipc-failure']);
    errSpy.mockRestore();
  });
});
