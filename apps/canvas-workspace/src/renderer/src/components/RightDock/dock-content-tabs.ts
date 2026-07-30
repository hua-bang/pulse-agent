import { CHAT_TAB_ID, isTerminalTabId } from './dock-tab-ids';
import type { DockState } from './dock-types';

/**
 * "Content tabs" = the link / artifact / node-detail / canvas-preview tabs in
 * `state.tabs`. They are the only dock panes a full-page chat route can show:
 * that route hides the pinned Pulse AI tab (`isDockChatTabEnabled`) and
 * terminal tabs ride along with it.
 */
export const hasDockContentTabs = (state: DockState): boolean => state.tabs.length > 0;

/** Whether a content tab is on screen right now. */
export const isDockContentTabVisible = (state: DockState): boolean => (
  state.expanded
  && hasDockContentTabs(state)
  && state.activeTabId !== CHAT_TAB_ID
  && !isTerminalTabId(state.activeTabId)
);

/**
 * Show/hide the dock's content tabs from a surface that owns no chat tab.
 *
 * `openChat`/`toggleChat` are useless there — the tab they target is hidden by
 * the route — so a full-page chat needs its own switch that only ever moves
 * between "content tab shown" and "dock collapsed". An active pointer left on
 * the chat or a terminal tab counts as hidden, not as something to collapse:
 * the route guard in `RightDock` is what re-points it at a content tab, and
 * collapsing instead would make the first click look like a no-op.
 */
export const getToggleContentTabsPatch = (state: DockState): Partial<DockState> | undefined => {
  if (!hasDockContentTabs(state)) return undefined;
  if (isDockContentTabVisible(state)) return { expanded: false };
  const activeIsContentTab = state.tabs.some((tab) => tab.id === state.activeTabId);
  return {
    expanded: true,
    activeTabId: activeIsContentTab ? state.activeTabId : state.tabs[0].id,
  };
};
