import type { ComponentType } from 'react';
import type {
  ChatCardSpec,
  ChatMessageRef,
  PluginBridge,
  RendererCanvasPlugin,
  RendererCtx,
} from '../types';

interface RouteEntry {
  pluginId: string;
  path: string;
  Component: ComponentType;
}

interface ChatCardEntry {
  pluginId: string;
  spec: ChatCardSpec<unknown>;
}

const routes: RouteEntry[] = [];
const chatCards: ChatCardEntry[] = [];
const activated = new Set<string>();

// The preload-side bridge is looked up lazily on each invoke so renderer
// plugins can be authored without depending on a specific global shape.
// If the bridge is missing the plugin gets a clear runtime error rather
// than a silent hang.
function resolveBridge(pluginId: string): PluginBridge {
  const bridge = (
    globalThis as { canvasWorkspace?: { plugin?: PluginBridge } }
  ).canvasWorkspace?.plugin;
  if (!bridge) {
    throw new Error(
      `[canvas-plugins] plugin bridge missing; invoke from ${pluginId} cannot proceed`,
    );
  }
  return bridge;
}

export function activateCanvasPlugins(plugins: RendererCanvasPlugin[]): void {
  for (const plugin of plugins) {
    if (activated.has(plugin.id)) {
      console.warn(`[canvas-plugins] duplicate plugin id, skipping: ${plugin.id}`);
      continue;
    }
    if (plugin.enabledWhen && !plugin.enabledWhen()) continue;

    const ctx: RendererCtx = {
      registerRoute(path, Component) {
        if (routes.some((r) => r.path === path)) {
          console.warn(
            `[canvas-plugins] duplicate route "${path}" from ${plugin.id}, skipping`,
          );
          return;
        }
        routes.push({ pluginId: plugin.id, path, Component });
      },
      registerChatCard(spec) {
        if (chatCards.some((c) => c.spec.id === spec.id)) {
          console.warn(
            `[canvas-plugins] duplicate chat card "${spec.id}" from ${plugin.id}, skipping`,
          );
          return;
        }
        chatCards.push({
          pluginId: plugin.id,
          spec: spec as ChatCardSpec<unknown>,
        });
      },
      invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
        return resolveBridge(plugin.id).invoke<T>(plugin.id, channel, ...args);
      },
    };

    try {
      plugin.activate(ctx);
      activated.add(plugin.id);
    } catch (err) {
      console.error(`[canvas-plugins] activate failed for ${plugin.id}`, err);
    }
  }
}

export function getRegisteredRoutes(): ReadonlyArray<RouteEntry> {
  return routes;
}

export function getRegisteredChatCards(): ReadonlyArray<ChatCardEntry> {
  return chatCards;
}

export function findMatchingChatCard<T extends ChatMessageRef>(
  message: T,
): { entry: ChatCardEntry; payload: unknown } | null {
  for (const entry of chatCards) {
    const payload = entry.spec.match(message);
    if (payload != null) return { entry, payload };
  }
  return null;
}
