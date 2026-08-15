import type { AgentContextTabRef } from '../../../types';
import { TERMINAL_TAB_ID, type DockState } from './dock-store';

/**
 * The PTY session id a workspace terminal tab writes to. Mirrors the mapping
 * in WorkspaceTerminalDock so terminal-tab reads (`canvas_read_tab`) hit the
 * right scrollback buffer: the primary tab has no ordinal suffix.
 */
export function terminalSessionId(workspaceId: string, terminalTabId: string): string {
  return terminalTabId === TERMINAL_TAB_ID
    ? `workspace-terminal:${workspaceId}`
    : `workspace-terminal:${workspaceId}:${terminalTabId}`;
}

/**
 * Project the open right-dock tabs into `@`-mentionable tab refs for a given
 * workspace's chat. Link tabs are application-global; `dockWorkspaceId` only
 * tells the host which renderer workspace currently mounts their WebView.
 * Artifact/node-detail previews remain shared, and terminal tabs are
 * per-workspace.
 */
export function buildDockTabRefs(state: DockState, workspaceId: string): AgentContextTabRef[] {
  const refs: AgentContextTabRef[] = [];
  const presentation = (id: string): Pick<AgentContextTabRef, 'isActive' | 'isVisible' | 'isSplit'> => ({
    isActive: state.activeTabId === id,
    isVisible: state.expanded && (state.activeTabId === id || state.splitTabId === id),
    isSplit: state.splitTabId === id,
  });

  for (const tab of state.tabs) {
    if (tab.kind === 'link') {
      if (!tab.url) continue; // blank "New tab" — nothing to read yet
      refs.push({ id: tab.id, kind: 'link', scope: 'global', title: tab.title, url: tab.url, dockWorkspaceId: workspaceId, ...presentation(tab.id) });
    } else if (tab.kind === 'artifact') {
      refs.push({ id: tab.id, kind: 'artifact', title: tab.title, workspaceId: tab.workspaceId, dockWorkspaceId: workspaceId, artifactId: tab.artifactId, ...presentation(tab.id) });
    } else if (tab.kind === 'node-detail') {
      refs.push({ id: tab.id, kind: 'node-detail', title: tab.title, workspaceId: tab.workspaceId, dockWorkspaceId: workspaceId, nodeId: tab.nodeId, ...presentation(tab.id) });
    } else if (tab.kind === 'canvas') {
      refs.push({ id: tab.id, kind: 'canvas', title: tab.title, workspaceId: tab.workspaceId, dockWorkspaceId: workspaceId, ...presentation(tab.id) });
    }
  }

  const terminals = state.terminalTabsByWorkspace[workspaceId]?.tabs ?? [];
  for (const tab of terminals) {
    refs.push({
      id: tab.id,
      kind: 'terminal',
      title: tab.title || `Terminal ${tab.ordinal}`,
      workspaceId,
      dockWorkspaceId: workspaceId,
      sessionId: terminalSessionId(workspaceId, tab.id),
      ...presentation(tab.id),
    });
  }

  return refs;
}

/**
 * Project only the global browser tabs for the main-process Agent mirror.
 * The mirror keeps these separate from workspace-owned resource tabs so
 * Global chat can enumerate and operate them without a workspaceId.
 */
export function buildGlobalDockTabRefs(state: DockState, workspaceId: string): AgentContextTabRef[] {
  return buildDockTabRefs(state, workspaceId).filter((tab) => tab.kind === 'link');
}
