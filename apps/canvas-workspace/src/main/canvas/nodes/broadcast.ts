import { BrowserWindow } from 'electron';

/**
 * Pushed to every renderer window when workspace-node knowledge metadata
 * (tags / properties / links) changes in the main process — e.g. after the
 * agent's `canvas_tag_node` writes. Views built on `useAllWorkspaceNodeList`
 * (the Graph + Nodes pages) listen for this and reload, so tags applied from
 * chat show up live instead of only after a manual refresh.
 */
export interface WorkspaceNodesChangeEvent {
  workspaceIds: string[];
  source: 'canvas-agent' | 'renderer';
}

export const WORKSPACE_NODES_CHANGE_CHANNEL = 'workspace-node:change';

export function broadcastWorkspaceNodesChanged(
  workspaceIds: string[],
  source: WorkspaceNodesChangeEvent['source'] = 'canvas-agent',
): void {
  const unique = Array.from(new Set(workspaceIds.filter(Boolean)));
  if (unique.length === 0) return;
  const payload: WorkspaceNodesChangeEvent = { workspaceIds: unique, source };
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(WORKSPACE_NODES_CHANGE_CHANNEL, payload);
  }
}
