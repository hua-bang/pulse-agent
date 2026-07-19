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
const publishedWorkspaceByWebContents = new Map<number, string>();

/** Open dock tabs last published for a workspace (empty if none/unknown). */
export function getDockTabs(workspaceId: string): AgentContextTabRef[] {
  return dockTabsByWorkspace.get(workspaceId) ?? [];
}

/** Last workspace projection published by one host renderer. */
export function getPublishedDockWorkspaceId(webContentsId: number): string {
  return publishedWorkspaceByWebContents.get(webContentsId) ?? '';
}

export function setupDockTabsIpc(): void {
  ipcMain.on(
    'dock:publish-tabs',
    (event, payload: { workspaceId?: string; tabs?: AgentContextTabRef[] }) => {
      if (!payload?.workspaceId || !Array.isArray(payload.tabs)) return;
      dockTabsByWorkspace.set(payload.workspaceId, payload.tabs);
      publishedWorkspaceByWebContents.set(event.sender.id, payload.workspaceId);
    },
  );
}
