/**
 * Pure per-workspace terminal-tab transitions for the dock store. Each
 * function returns the next workspace record plus the top-level `DockState`
 * patch it implies (or null for a no-op); `DockStore` only commits them.
 */
import { CHAT_TAB_ID, terminalTabId } from './dock-tab-ids';
import type { DockState, DockTerminalTab, DockTerminalWorkspaceState } from './dock-types';

export interface TerminalCommit {
  workspace: DockTerminalWorkspaceState;
  patch: Partial<DockState>;
}

const createTerminalTab = (workspace: DockTerminalWorkspaceState): DockTerminalTab => ({
  id: terminalTabId(workspace.nextOrdinal),
  ordinal: workspace.nextOrdinal,
});

/** The terminal a workspace would show right now, if it has one. */
const currentTerminalId = (workspace: DockTerminalWorkspaceState): string | undefined => (
  workspace.activeTabId && workspace.tabs.some((tab) => tab.id === workspace.activeTabId)
    ? workspace.activeTabId
    : workspace.tabs[0]?.id
);

/** Focus the workspace's terminal, creating the first one if there is none. */
export function openTerminalCommit(
  state: DockState,
  workspace: DockTerminalWorkspaceState,
): TerminalCommit | null {
  const existingId = currentTerminalId(workspace);
  if (existingId) {
    if (state.expanded && state.activeTabId === existingId) return null;
    return {
      workspace: { ...workspace, activeTabId: existingId },
      patch: { expanded: true, activeTabId: existingId },
    };
  }
  const tab = createTerminalTab(workspace);
  return {
    workspace: { tabs: [tab], activeTabId: tab.id, nextOrdinal: workspace.nextOrdinal + 1 },
    patch: { activeTabId: tab.id, expanded: true },
  };
}

export function newTerminalCommit(workspace: DockTerminalWorkspaceState): TerminalCommit {
  const tab = createTerminalTab(workspace);
  return {
    workspace: {
      tabs: [...workspace.tabs, tab],
      activeTabId: tab.id,
      nextOrdinal: workspace.nextOrdinal + 1,
    },
    patch: { activeTabId: tab.id, expanded: true },
  };
}

export function closeTerminalCommit(
  state: DockState,
  workspace: DockTerminalWorkspaceState,
  id: string,
): TerminalCommit | null {
  const index = workspace.tabs.findIndex((tab) => tab.id === id);
  if (index === -1) return null;
  const tabs = workspace.tabs.filter((tab) => tab.id !== id);
  const closingActive = state.activeTabId === id;
  const activeTerminalTabId = tabs[Math.min(index, tabs.length - 1)]?.id ?? tabs[tabs.length - 1]?.id;
  const activeTabId = closingActive
    ? (activeTerminalTabId ?? state.tabs[0]?.id ?? CHAT_TAB_ID)
    : state.activeTabId;
  return {
    workspace: { tabs, activeTabId: activeTerminalTabId, nextOrdinal: workspace.nextOrdinal },
    patch: {
      activeTabId,
      ...(state.splitTabId === id ? { splitTabId: undefined } : {}),
      expanded: closingActive && tabs.length === 0 && state.tabs.length === 0
        ? false
        : state.expanded,
      ...(activeTabId === CHAT_TAB_ID ? { chatUnread: false } : {}),
    },
  };
}

export function renameTerminalCommit(
  workspace: DockTerminalWorkspaceState,
  id: string,
  title: string,
): TerminalCommit | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const tab = workspace.tabs.find((item) => item.id === id);
  if (!tab || tab.title === trimmed) return null;
  return {
    workspace: {
      ...workspace,
      tabs: workspace.tabs.map((item) => (item.id === id ? { ...item, title: trimmed } : item)),
    },
    patch: {},
  };
}
