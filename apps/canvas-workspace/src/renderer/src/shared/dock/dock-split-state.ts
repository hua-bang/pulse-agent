import { CHAT_TAB_ID, isTerminalTabId } from './dock-tab-ids';
import type { DockComparisonPair, DockState } from '../dockTypes';

export const hasDockTab = (state: DockState, id: string): boolean => (
  id === CHAT_TAB_ID
  || state.tabs.some((tab) => tab.id === id)
  || state.terminalTabs.some((tab) => tab.id === id)
);

export const isDockTabPresented = (
  activeTabId: string | null,
  comparisonPair: Readonly<DockComparisonPair> | undefined,
  tabId: string,
): boolean => comparisonPair?.includes(tabId) ?? activeTabId === tabId;

export const getRenderableComparisonPair = (
  state: DockState,
  chatTabEnabled: boolean,
): DockComparisonPair | undefined => (
  chatTabEnabled || !state.splitTabIds?.includes(CHAT_TAB_ID) ? state.splitTabIds : undefined
);

export const getComparisonSurvivorId = (
  state: DockState,
  closingId: string,
): string | undefined => {
  const pair = state.splitTabIds;
  if (!pair?.includes(closingId)) return undefined;
  return pair[0] === closingId ? pair[1] : pair[0];
};

const isValidPair = (state: DockState, ids: DockComparisonPair): boolean => (
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
      const nextPair: DockComparisonPair = [...current.splitTabIds];
      const stalePaneIndex = nextPair.findIndex((id) => !hasDockTab(candidate, id));
      // Focus routes input, never decides where the next page opens.
      const replaceIndex = stalePaneIndex >= 0 ? stalePaneIndex : 0;
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
  if (state.splitTabIds) return { splitTabIds: undefined, activeTabId: state.splitTabIds[0] };
  if (state.activeTabId === CHAT_TAB_ID || !hasDockTab(state, state.activeTabId)) return null;
  return {
    expanded: true,
    splitTabIds: [state.activeTabId, CHAT_TAB_ID],
    chatUnread: false,
  };
};

/** Explicit placement is the only way to replace the pinned right pane.
 * Moving a visible tab to the other side swaps the pair, never duplicates it. */
export const getDockPaneSelection = (
  state: DockState, id: string, side: 'left' | 'right',
): Partial<DockState> | null => {
  if (!hasDockTab(state, id)) return null;
  const pair = state.splitTabIds;
  if (!pair && side === 'left') return { activeTabId: id, expanded: true };
  const slot = side === 'left' ? 0 : 1;
  const other = pair?.[1 - slot] ?? state.activeTabId;
  if (other === id && !pair) return null;
  const ids: DockComparisonPair = pair ? [...pair] : [other, id];
  if (ids[1 - slot] === id) ids[1 - slot] = ids[slot];
  ids[slot] = id;
  if (!isValidPair(state, ids)) return null;
  return { splitTabIds: ids, activeTabId: id, expanded: true, ...(ids.includes(CHAT_TAB_ID) ? { chatUnread: false } : {}) };
};
