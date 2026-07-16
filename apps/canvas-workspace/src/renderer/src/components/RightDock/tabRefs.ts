import type { AgentContextTabRef } from '../../types';
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
 * workspace's chat. Preview tabs (link/artifact/node-detail) are shared across
 * workspaces; terminal tabs are per-workspace. Link tabs read through the
 * webview registered under the chat's own workspaceId.
 */
export function buildDockTabRefs(state: DockState, workspaceId: string): AgentContextTabRef[] {
  const refs: AgentContextTabRef[] = [];

  for (const tab of state.tabs) {
    if (tab.kind === 'link') {
      if (!tab.url) continue; // blank "New tab" — nothing to read yet
      refs.push({ id: tab.id, kind: 'link', title: tab.title, url: tab.url, workspaceId });
    } else if (tab.kind === 'artifact') {
      refs.push({ id: tab.id, kind: 'artifact', title: tab.title, workspaceId: tab.workspaceId, artifactId: tab.artifactId });
    } else if (tab.kind === 'node-detail') {
      refs.push({ id: tab.id, kind: 'node-detail', title: tab.title, workspaceId: tab.workspaceId, nodeId: tab.nodeId });
    }
  }

  const terminals = state.terminalTabsByWorkspace[workspaceId]?.tabs ?? [];
  for (const tab of terminals) {
    refs.push({
      id: tab.id,
      kind: 'terminal',
      title: tab.title || `Terminal ${tab.ordinal}`,
      workspaceId,
      sessionId: terminalSessionId(workspaceId, tab.id),
    });
  }

  return refs;
}
