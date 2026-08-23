import { CHAT_TAB_ID } from './dock-tab-ids';
import { isDockTabPresented } from './dock-split-state';
import type { DockState } from './dock-types';

export const isDockChatVisible = (state: DockState): boolean => (
  state.expanded
  && isDockTabPresented(state.activeTabId, state.splitTabIds, CHAT_TAB_ID)
);

export const isDockTerminalVisible = (state: DockState): boolean => (
  state.expanded
  && state.terminalTabs.some(
    (tab) => isDockTabPresented(state.activeTabId, state.splitTabIds, tab.id),
  )
);
