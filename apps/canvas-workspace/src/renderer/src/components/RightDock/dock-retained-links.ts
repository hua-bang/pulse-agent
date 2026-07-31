import { getOpenLinkPatch, type DockOpenLinkOptions } from './dock-link-commands';
import type { DockLinkSession, DockLinkTab } from './dock-link-sessions';
import { applyRetainedTabPatch } from './dock-link-tabs';
import type { DockState, RetainedLinkWorkspace } from './dock-types';

export interface RetainedLinkMutation {
  retainedLinkTabs?: RetainedLinkWorkspace[];
  session: {
    tabs: DockLinkTab[];
    activeTabId?: string;
  };
}

/** Open a page beside an opener that belongs to a retained workspace. */
export function getOpenWorkspaceLinkMutation(
  state: DockState,
  workspaceId: string,
  url: string,
  options: DockOpenLinkOptions,
  persistedSession?: DockLinkSession,
): RetainedLinkMutation | null {
  const entryIndex = state.retainedLinkTabs.findIndex(
    (entry) => entry.workspaceId === workspaceId,
  );
  const entry = entryIndex === -1 ? persistedSession : state.retainedLinkTabs[entryIndex];
  const tabsBefore = entry?.tabs ?? [];
  const next = getOpenLinkPatch({
    ...state,
    tabs: tabsBefore,
    activeTabId: entry?.activeTabId ?? tabsBefore[0]?.id ?? state.activeTabId,
    expanded: false,
  }, url, { ...options, background: true });
  if (!next?.tabs) return null;
  const tabs = next.tabs.filter((tab): tab is DockLinkTab => tab.kind === 'link');
  const retainedLinkTabs = entryIndex === -1 ? undefined : [...state.retainedLinkTabs];
  if (retainedLinkTabs) {
    retainedLinkTabs[entryIndex] = { ...state.retainedLinkTabs[entryIndex], tabs };
  }
  return {
    retainedLinkTabs,
    session: { tabs, activeTabId: entry?.activeTabId },
  };
}

/** Fold a live hidden guest update into both retention and persistence. */
export function getRetainedLinkTabMutation(
  current: readonly RetainedLinkWorkspace[],
  workspaceId: string,
  tabId: string,
  patch: Partial<Pick<DockLinkTab, 'url' | 'title' | 'faviconUrl'>>,
): RetainedLinkMutation | null {
  const retainedLinkTabs = applyRetainedTabPatch(current, workspaceId, tabId, patch);
  if (!retainedLinkTabs) return null;
  const entry = retainedLinkTabs.find((item) => item.workspaceId === workspaceId);
  if (!entry) return null;
  return {
    retainedLinkTabs,
    session: { tabs: entry.tabs, activeTabId: entry.activeTabId },
  };
}
