import type { McpAppEntrypointListing } from '../../../../../../shared/mcp-apps';
import type { AgentScope } from '../../../../types';

/** Global apps come from the global agent scope, never a workspace scope. */
export const GLOBAL_MCP_APP_SCOPE: AgentScope = { kind: 'global' };

export interface GlobalMcpAppTarget {
  serverName: string;
  toolName: string;
}

export interface RunningGlobalMcpApp {
  key: string;
  listing: McpAppEntrypointListing;
  /** Bumped by reload; the pane remounts and re-opens the entrypoint. */
  revision: number;
}

export interface GlobalMcpAppsSnapshot {
  /** OpenAI `global` entrypoints of the loaded MCP servers. */
  listings: McpAppEntrypointListing[];
  loaded: boolean;
  /** Opened apps, in opening order. Each keeps one live view until closed. */
  running: RunningGlobalMcpApp[];
}

export const globalMcpAppKey = ({ serverName, toolName }: GlobalMcpAppTarget): string => (
  `${serverName}\n${toolName}`
);

/**
 * Renderer-lifetime state for OpenAI `global` entrypoints: one instance per
 * server tool, shared by every workspace and kept until the user closes it.
 * Nothing is persisted, so a restart starts with no running apps.
 */
export class GlobalMcpAppsStore {
  private snapshot: GlobalMcpAppsSnapshot = { listings: [], loaded: false, running: [] };
  private listeners = new Set<() => void>();
  private refreshing: Promise<void> | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  getSnapshot = (): GlobalMcpAppsSnapshot => this.snapshot;

  private commit(next: Partial<GlobalMcpAppsSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of [...this.listeners]) listener();
  }

  /** Reload the entrypoint list; concurrent calls share one request. */
  refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    const mcpApps = window.canvasWorkspace?.agent?.mcpApps;
    if (!mcpApps) return Promise.resolve();
    this.refreshing = mcpApps.listEntrypoints(GLOBAL_MCP_APP_SCOPE)
      .then((result) => {
        if (!result.ok) return;
        const listings = (result.value ?? []).filter(listing => listing.kind === 'global');
        this.commit({ listings, loaded: true });
      })
      .catch(() => undefined)
      .finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  find(target: GlobalMcpAppTarget): McpAppEntrypointListing | undefined {
    const key = globalMcpAppKey(target);
    return this.snapshot.running.find(app => app.key === key)?.listing
      ?? this.snapshot.listings.find(listing => globalMcpAppKey(listing) === key);
  }

  open(listing: McpAppEntrypointListing): void {
    const key = globalMcpAppKey(listing);
    if (this.snapshot.running.some(app => app.key === key)) return;
    this.commit({ running: [...this.snapshot.running, { key, listing, revision: 0 }] });
  }

  reload(key: string): void {
    this.commit({
      running: this.snapshot.running.map(app => (
        app.key === key ? { ...app, revision: app.revision + 1 } : app
      )),
    });
  }

  close(key: string): void {
    this.commit({ running: this.snapshot.running.filter(app => app.key !== key) });
  }
}

export const globalMcpAppsStore = new GlobalMcpAppsStore();
