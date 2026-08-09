import { CHAT_TAB_ID } from './dock-store';

export interface DockTabVisualState {
  focused: boolean;
  selected: boolean;
  splitActive: boolean;
  splitVisible: boolean;
  splitPart: 'chat' | 'content' | undefined;
}

export const getDockTabVisualState = (
  tabId: string,
  activePaneId: string | null,
  splitTabId: string | undefined,
): DockTabVisualState => {
  const splitActive = Boolean(splitTabId);
  const splitVisible = splitActive && (tabId === CHAT_TAB_ID || tabId === splitTabId);
  return {
    focused: tabId === activePaneId,
    selected: tabId === activePaneId || splitVisible,
    splitActive,
    splitVisible,
    splitPart: !splitVisible ? undefined : tabId === CHAT_TAB_ID ? 'chat' : 'content',
  };
};
