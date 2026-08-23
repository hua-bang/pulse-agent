import { CHAT_TAB_ID, isTerminalTabId } from './dock-tab-ids';
import type { DockState } from './dock-types';

export const hasDockTab = (state: DockState, id: string): boolean => (
  id === CHAT_TAB_ID
  || state.tabs.some((tab) => tab.id === id)
  || state.terminalTabs.some((tab) => tab.id === id)
);

const isValidPair = (state: DockState, ids: [string, string]): boolean => (
  ids[0] !== ids[1]
  && hasDockTab(state, ids[0])
  && hasDockTab(state, ids[1])
  && !(isTerminalTabId(ids[0]) && isTerminalTabId(ids[1]))
);

export const applyDockSplitState = (current: DockState, next: Partial<DockState>): DockState => {
  const splitSpecified = Object.prototype.hasOwnProperty.call(next, 'splitTabIds');
  const candidate = { ...current, ...next };

  if (!splitSpecified && current.splitTabIds && candidate.activeTabId !== current.activeTabId) {
    const selectedId = candidate.activeTabId;
    if (!current.splitTabIds.includes(selectedId) && hasDockTab(candidate, selectedId)) {
      const nextPair: [string, string] = [...current.splitTabIds];
      const existingTerminalIndex = isTerminalTabId(selectedId)
        ? nextPair.findIndex((id) => isTerminalTabId(id))
        : -1;
      const stalePaneIndex = nextPair.findIndex((id) => !hasDockTab(candidate, id));
      const focusedIndex = current.splitTabIds.indexOf(current.activeTabId);
      const replaceIndex = existingTerminalIndex >= 0
        ? existingTerminalIndex
        : stalePaneIndex >= 0 ? stalePaneIndex
        : focusedIndex >= 0 ? focusedIndex : 0;
      nextPair[replaceIndex] = selectedId;
      candidate.splitTabIds = nextPair;
    }
  }

  if (candidate.splitTabIds && !isValidPair(candidate, candidate.splitTabIds)) {
    candidate.splitTabIds = undefined;
  }
  return candidate;
};

export const getSplitViewToggle = (state: DockState): Partial<DockState> | null => {
  if (state.splitTabIds) return { splitTabIds: undefined };
  if (state.activeTabId === CHAT_TAB_ID || !hasDockTab(state, state.activeTabId)) return null;
  return {
    expanded: true,
    splitTabIds: [state.activeTabId, CHAT_TAB_ID],
    chatUnread: false,
  };
};
