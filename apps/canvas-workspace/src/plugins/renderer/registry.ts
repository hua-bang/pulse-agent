import type { ComponentType } from 'react';
import type {
  ChatCardSpec,
  ChatMessageRef,
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

export function findMatchingChatCard(
  message: ChatMessageRef,
): { entry: ChatCardEntry; payload: unknown } | null {
  for (const entry of chatCards) {
    const payload = entry.spec.match(message);
    if (payload != null) return { entry, payload };
  }
  return null;
}
