import { CHAT_TAB_ID } from './dock-tab-ids';
import type { DockState } from './dock-types';

export const isDockChatVisible = (state: DockState): boolean => (
  state.expanded && (state.activeTabId === CHAT_TAB_ID || Boolean(state.splitTabId))
);

export const isDockTerminalVisible = (state: DockState): boolean => (
  state.expanded
  && state.terminalTabs.some(
    (tab) => tab.id === state.activeTabId || tab.id === state.splitTabId,
  )
);
