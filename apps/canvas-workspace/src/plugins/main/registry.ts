import { ipcMain } from 'electron';
import type { MainCanvasPlugin, MainCtx } from '../types';
import { agentBus } from './agent-bus';
import { createPluginStore } from './plugin-store';

const loaded = new Set<string>();

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

function createMainCtx(pluginId: string): MainCtx {
  return {
    store: createPluginStore(pluginId),
    registerIpc(channel, handler) {
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
  };
}
