import { CHAT_TAB_ID } from './dock-tab-ids';
import type { DockState } from './dock-types';

export const isDockChatVisible = (state: DockState): boolean => (
  state.expanded
  && (state.activeTabId === CHAT_TAB_ID || state.splitTabIds?.includes(CHAT_TAB_ID) === true)
);

export const isDockTerminalVisible = (state: DockState): boolean => (
  state.expanded
  && state.terminalTabs.some(
    (tab) => tab.id === state.activeTabId || state.splitTabIds?.includes(tab.id) === true,
  )
);
