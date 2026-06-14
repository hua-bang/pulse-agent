/**
 * Plugin registry — focused on the `registerCanvasTool` extension added
 * for the webview-page-control refactor. The `ipcMain.handle` /
 * `onAgent` halves of `MainCtx` are already exercised by the devtools
 * plugin and the e2e flow; here we just need to prove that:
 *
 *   - `enabledWhen: () => false` plugins do NOT contribute tools.
 *   - `enabledWhen: () => true` plugins DO, and their factory receives
 *     the right `workspaceId` for each canvas-agent.
 *   - Multiple plugins compose; the latest registration with a given
 *     plugin id overwrites the previous one.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub `electron` BEFORE importing the registry. We need `ipcMain.handle`
// (for the plugin handle bridge), and `app.getPath` (used by
// `createPluginStore` to pick a userData directory). Tests don't touch
// the store, but `createMainCtx` builds one eagerly and it would throw
// without `app.getPath`. `vi.mock` is hoisted above imports, so the
// factory closure must not capture any test-file constants.
vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn(),
  },
  app: {
    getPath: () => '/tmp/canvas-plugins-registry-test',
  },
}));

// Reset the registry module between tests so the WeakMap of registered
// factories is fresh — there's no public clear() API, and we don't want
// to add one just for tests.
async function loadRegistry() {
  vi.resetModules();
  return await import('../registry');
}

describe('setupCanvasPlugins + registerCanvasTool', () => {
  beforeEach(() => {
    vi.resetModules();
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
});
