import { CHAT_TAB_ID } from './dock-tab-ids';
import type { DockState } from './dock-types';

export const hasDockSplitContentTab = (state: DockState, id: string): boolean => (
  state.tabs.some((tab) => tab.id === id && tab.kind === 'link')
  || state.terminalTabs.some((tab) => tab.id === id)
);

export const applyDockSplitState = (current: DockState, next: Partial<DockState>): DockState => {
  const splitSpecified = Object.prototype.hasOwnProperty.call(next, 'splitTabId');
  const candidate = { ...current, ...next };
  if (!splitSpecified && current.splitTabId && candidate.activeTabId !== CHAT_TAB_ID) {
    candidate.splitTabId = hasDockSplitContentTab(candidate, candidate.activeTabId)
      ? candidate.activeTabId
      : undefined;
  }
  if (candidate.splitTabId && !hasDockSplitContentTab(candidate, candidate.splitTabId)) {
    candidate.splitTabId = undefined;
  }
  return candidate;
};

export const getSplitViewToggle = (state: DockState): Partial<DockState> | null => {
  if (state.splitTabId) return { splitTabId: undefined };
  if (!hasDockSplitContentTab(state, state.activeTabId)) return null;
  return { expanded: true, splitTabId: state.activeTabId, chatUnread: false };
};
