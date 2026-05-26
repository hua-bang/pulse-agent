import { ipcMain } from 'electron';
import type { CanvasToolFactory, MainCanvasPlugin, MainCtx } from '../types';
import { agentBus } from './agent-bus';
import { createPluginStore } from './plugin-store';

const loaded = new Set<string>();

/**
 * Registered canvas-tool factories, keyed by plugin id so a plugin
 * activating twice (in dev with HMR, say) replaces its own factory
 * cleanly. The host calls {@link getRegisteredCanvasToolFactories} at
 * canvas-agent construction time to assemble plugin-contributed tools.
 */
const canvasToolFactories = new Map<string, CanvasToolFactory>();

export async function setupCanvasPlugins(plugins: MainCanvasPlugin[]): Promise<void> {
  for (const plugin of plugins) {
    if (loaded.has(plugin.id)) {
      console.warn(`[canvas-plugins] duplicate plugin id, skipping: ${plugin.id}`);
      continue;
    }
    if (plugin.enabledWhen && !plugin.enabledWhen()) {
      continue;
    }
    try {
      await plugin.activate(createMainCtx(plugin.id));
      loaded.add(plugin.id);
    } catch (err) {
      console.error(`[canvas-plugins] activate failed for ${plugin.id}`, err);
    }
  }
}

/**
 * Snapshot of the registered tool factories at call time. Returned as
 * `[pluginId, factory]` pairs so the host can attribute tools to their
 * source plugin in errors / logs.
 */
export function getRegisteredCanvasToolFactories(): ReadonlyArray<[string, CanvasToolFactory]> {
  return Array.from(canvasToolFactories.entries());
}

function createMainCtx(pluginId: string): MainCtx {
  return {
    store: createPluginStore(pluginId),
    handle(channel, handler) {
      const fqChannel = `plugin:${pluginId}:${channel}`;
      // Cast at the boundary: MainCtx exposes a structural IpcInvokeEvent
      // to keep the shared types file free of an electron import.
      ipcMain.handle(fqChannel, handler as Parameters<typeof ipcMain.handle>[1]);
    },
    onAgent(event, handler) {
      agentBus.on(event, handler);
      return () => {
        agentBus.off(event, handler);
      };
    },
    registerCanvasTool(factory) {
      if (canvasToolFactories.has(pluginId)) {
        console.warn(
          `[canvas-plugins] ${pluginId} called registerCanvasTool twice; replacing previous factory`,
        );
      }
      canvasToolFactories.set(pluginId, factory);
    },
  };
}
