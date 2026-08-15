/**
 * Main-process mirror of the right-dock tab list.
 *
 * The dock's tabs live in the renderer (RightDock DockStore). The renderer
 * publishes a snapshot per workspace via `dock:publish-tabs`; the Canvas Agent
 * reads it through the `canvas_list_tabs` tool. Read-only from main — this is
 * a view of renderer state, not a source of truth.
 */
import { ipcMain } from 'electron';
import type { AgentContextTabRef } from '../../shared/agent-chat';

const dockTabsByWorkspace = new Map<string, AgentContextTabRef[]>();
let globalDockTabs: AgentContextTabRef[] = [];
const publishedWorkspaceByWebContents = new Map<number, string>();

/** Open dock tabs last published for a workspace (empty if none/unknown). */
export function getDockTabs(workspaceId: string): AgentContextTabRef[] {
  return dockTabsByWorkspace.get(workspaceId) ?? [];
}

/** Open browser tabs. Link tabs are app-scoped even though their WebViews are
 * currently mounted by one renderer workspace at a time. */
export function getGlobalDockTabs(): AgentContextTabRef[] {
  return globalDockTabs;
}

export function getGlobalDockTab(tabId: string): AgentContextTabRef | undefined {
  return globalDockTabs.find((tab) => tab.kind === 'link' && tab.id === tabId);
}

/** Renderer workspace currently mounting a global link tab's WebView. */
export function getGlobalDockTabWorkspaceId(tabId: string): string {
  return getGlobalDockTab(tabId)?.dockWorkspaceId ?? '';
}

/** Last workspace projection published by one host renderer. */
export function getPublishedDockWorkspaceId(webContentsId: number): string {
  return publishedWorkspaceByWebContents.get(webContentsId) ?? '';
}

export function setupDockTabsIpc(): void {
  ipcMain.on(
    'dock:publish-tabs',
    (event, payload: { workspaceId?: string; tabs?: AgentContextTabRef[]; scope?: 'global' | 'workspace' }) => {
      if (!payload?.workspaceId || !Array.isArray(payload.tabs)) return;
      if (payload.scope === 'global') {
        globalDockTabs = payload.tabs.filter((tab) => tab.kind === 'link');
      } else {
        dockTabsByWorkspace.set(payload.workspaceId, payload.tabs);
      }
      publishedWorkspaceByWebContents.set(event.sender.id, payload.workspaceId);
    },
  );
}
