import type { ComponentType } from 'react';
import type {
  ChatCardSpec,
  ChatMessageRef,
  NavItem,
  PluginBridge,
  PluginNodeViewProps,
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

interface NavItemEntry {
  pluginId: string;
  item: NavItem;
}

interface NodeViewEntry {
  pluginId: string;
  nodeType: string;
  Component: ComponentType<PluginNodeViewProps>;
}

const routes: RouteEntry[] = [];
const chatCards: ChatCardEntry[] = [];
const navItems: NavItemEntry[] = [];
const nodeViews: NodeViewEntry[] = [];
const activated = new Set<string>();
const registryListeners = new Set<() => void>();
let registryVersion = 0;

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

function emitRegistryChange(): void {
  registryVersion += 1;
  for (const listener of registryListeners) {
    listener();
  }
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
        emitRegistryChange();
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
        emitRegistryChange();
      },
      registerNavItem(item) {
        if (navItems.some((n) => n.item.id === item.id)) {
          console.warn(
            `[canvas-plugins] duplicate nav item "${item.id}" from ${plugin.id}, skipping`,
          );
          return;
        }
        navItems.push({ pluginId: plugin.id, item });
        emitRegistryChange();
      },
      registerNodeView(nodeType, Component) {
        if (!nodeType.trim()) {
          console.warn(`[canvas-plugins] ${plugin.id} tried to register an empty node type`);
          return;
        }
        const existingIndex = nodeViews.findIndex((entry) => entry.nodeType === nodeType);
        if (existingIndex !== -1) {
          console.warn(
            `[canvas-plugins] duplicate node view "${nodeType}" from ${plugin.id}, replacing previous registration`,
          );
          nodeViews.splice(existingIndex, 1);
        }
        nodeViews.push({ pluginId: plugin.id, nodeType, Component });
        emitRegistryChange();
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

export function subscribeRendererPluginRegistry(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

export function getRendererPluginRegistryVersion(): number {
  return registryVersion;
}

export function getRegisteredRoutes(): ReadonlyArray<RouteEntry> {
  return routes;
}

export function getRegisteredChatCards(): ReadonlyArray<ChatCardEntry> {
  return chatCards;
}

export function getRegisteredNavItems(): ReadonlyArray<NavItem> {
  return navItems.map((entry) => entry.item);
}

export function getRegisteredNodeViews(): ReadonlyArray<NodeViewEntry> {
  return nodeViews;
}

export function getRegisteredNodeView(nodeType: string): NodeViewEntry | undefined {
  return nodeViews.find((entry) => entry.nodeType === nodeType);
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
