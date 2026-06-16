import { ipcMain } from 'electron';
import type {
  CanvasAgentServiceRef,
  CanvasToolFactory,
  MainCanvasPlugin,
  MainCtx,
  PluginCanvasSnapshot,
  PluginNodeCapabilities,
  PluginNodeCapabilityEntry,
} from '../types';
import { loadCanvas } from '../../main/agent/tools/_shared/canvas-io';
import { resolveCanvasPluginConfigValue } from '../../main/settings/canvas-plugins-config';
import { withCdp, type CdpSender } from '../../main/webview/cdp-session';
import { getWebContentsForNode } from '../../main/webview/registry';
import { agentBus } from './agent-bus';
import { createPluginStore } from './plugin-store';

const loaded = new Set<string>();

/**
 * Accessor for the host's Canvas Agent service, injected by the host
 * ({@link setAgentServiceAccessor}) before plugins activate. Kept as a lazy
 * injection — rather than a static import of the agent module — so the
 * registry's own import graph stays light (the agent pulls in the engine)
 * and unit-testable in isolation.
 */
let agentServiceAccessor: (() => CanvasAgentServiceRef) | null = null;

export function setAgentServiceAccessor(accessor: () => CanvasAgentServiceRef): void {
  agentServiceAccessor = accessor;
}

/**
 * Plugins that activated successfully and expose a `deactivate` hook,
 * kept so {@link teardownCanvasPlugins} can release their resources
 * (sockets, timers, external connections) on app shutdown.
 */
const deactivators: Array<{ id: string; deactivate: () => void | Promise<void> }> = [];

/**
 * Registered canvas-tool factories, keyed by plugin id so a plugin
 * activating twice (in dev with HMR, say) replaces its own factory
 * cleanly. The host calls {@link getRegisteredCanvasToolFactories} at
 * canvas-agent construction time to assemble plugin-contributed tools.
 */
const canvasToolFactories = new Map<string, CanvasToolFactory>();
const nodeCapabilities = new Map<string, PluginNodeCapabilityEntry>();

export async function setupCanvasPlugins(plugins: MainCanvasPlugin[]): Promise<string[]> {
  const activated: string[] = [];
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
      activated.push(plugin.id);
      if (plugin.deactivate) {
        deactivators.push({ id: plugin.id, deactivate: plugin.deactivate.bind(plugin) });
      }
    } catch (err) {
      console.error(`[canvas-plugins] activate failed for ${plugin.id}`, err);
    }
  }
  return activated;
}

export async function deactivateCanvasPlugin(pluginId: string): Promise<void> {
  if (!loaded.has(pluginId)) return;
  loaded.delete(pluginId);
  canvasToolFactories.delete(pluginId);
  for (const [nodeType, entry] of Array.from(nodeCapabilities.entries())) {
    if (entry.pluginId === pluginId) nodeCapabilities.delete(nodeType);
  }

  for (let index = deactivators.length - 1; index >= 0; index -= 1) {
    const item = deactivators[index];
    if (item.id !== pluginId) continue;
    deactivators.splice(index, 1);
    try {
      await item.deactivate();
    } catch (err) {
      console.error(`[canvas-plugins] deactivate failed for ${pluginId}`, err);
    }
  }
}

/**
 * Tear down activated plugins that registered a `deactivate` hook. Called
 * on app shutdown (window-all-closed). Each hook is isolated so one failing
 * teardown does not block the others. Safe to call multiple times — the
 * deactivator list is drained as it runs.
 */
export async function teardownCanvasPlugins(): Promise<void> {
  const pending = deactivators.splice(0, deactivators.length);
  await Promise.all(
    pending.map(async ({ id, deactivate }) => {
      try {
        await deactivate();
      } catch (err) {
        console.error(`[canvas-plugins] deactivate failed for ${id}`, err);
      }
    }),
  );
}

/**
 * Snapshot of the registered tool factories at call time. Returned as
 * `[pluginId, factory]` pairs so the host can attribute tools to their
 * source plugin in errors / logs.
 */
export function getRegisteredCanvasToolFactories(): ReadonlyArray<[string, CanvasToolFactory]> {
  return Array.from(canvasToolFactories.entries());
}

export function getRegisteredNodeCapabilities(): ReadonlyArray<PluginNodeCapabilityEntry> {
  return Array.from(nodeCapabilities.values());
}

export function getRegisteredNodeCapability(
  nodeType: string,
): PluginNodeCapabilityEntry | undefined {
  return nodeCapabilities.get(nodeType);
}

function createMainCtx(pluginId: string): MainCtx {
  return {
    store: createPluginStore(pluginId),
    config: {
      async get(key) {
        return await resolveCanvasPluginConfigValue(pluginId, key);
      },
    },
    canvas: {
      async read(workspaceId): Promise<PluginCanvasSnapshot | null> {
        const canvas = await loadCanvas(workspaceId);
        return canvas ? { nodes: canvas.nodes as unknown as PluginCanvasSnapshot['nodes'] } : null;
      },
    },
    webviews: {
      get(workspaceId, nodeId) {
        return getWebContentsForNode(workspaceId, nodeId) ?? null;
      },
      async withCdp<T>(
        workspaceId: string,
        nodeId: string,
        fn: (send: CdpSender) => Promise<T>,
      ): Promise<T> {
        const webContents = getWebContentsForNode(workspaceId, nodeId);
        if (!webContents) {
          throw new Error(
            `No active webview found for node ${workspaceId}::${nodeId}. Open the node so its webview is mounted.`,
          );
        }
        return await withCdp(webContents, fn);
      },
    },
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
    getAgentService(): CanvasAgentServiceRef {
      if (!agentServiceAccessor) {
        throw new Error(
          '[canvas-plugins] agent service accessor not configured; ' +
            'call setAgentServiceAccessor() before activating plugins',
        );
      }
      return agentServiceAccessor();
    },
    registerCanvasTool(factory) {
      if (canvasToolFactories.has(pluginId)) {
        console.warn(
          `[canvas-plugins] ${pluginId} called registerCanvasTool twice; replacing previous factory`,
        );
      }
      canvasToolFactories.set(pluginId, factory);
    },
    registerNodeCapabilities(nodeType: string, capabilities: PluginNodeCapabilities) {
      const normalizedNodeType = nodeType.trim();
      if (!normalizedNodeType) {
        console.warn(`[canvas-plugins] ${pluginId} tried to register empty node capabilities`);
        return;
      }
      if (nodeCapabilities.has(normalizedNodeType)) {
        console.warn(
          `[canvas-plugins] duplicate node capabilities "${normalizedNodeType}" from ${pluginId}; replacing previous registration`,
        );
      }
      nodeCapabilities.set(normalizedNodeType, {
        pluginId,
        nodeType: normalizedNodeType,
        capabilities,
      });
    },
  };
}
