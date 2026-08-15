/**
 * Renderer-side glue for the shared web-tab keyboard policy
 * (`shared/dock-shortcuts.ts`): the command→store mapping used by both the
 * host-window listener and the main-process relay for keys pressed inside a
 * guest page.
 */
import type { DockBrowserCommand } from '../../../../../shared/dock-shortcuts';
import type { DockState, DockStore } from './dock-store';
import { dockTabElementId } from './dock-tab-ids';

/** Window event asking the visible web tab to focus its address bar. */
export const FOCUS_DOCK_ADDRESS_EVENT = 'canvas:focus-dock-address';

/** Window event asking the visible web tab to reload. */
export const RELOAD_DOCK_TAB_EVENT = 'canvas:reload-dock-tab';

/** Window event asking the visible web tab to open its find bar. */
export const FIND_IN_DOCK_TAB_EVENT = 'canvas:find-in-dock-tab';

/**
 * Window event asking a web tab to move keyboard focus into its page.
 * Raised only for a user browsing action (tab click/shortcut/menu/address
 * commit), never for an agent-driven activation. The workspace-qualified
 * detail prevents a retained same-id tab from claiming it.
 */
export const FOCUS_DOCK_PAGE_EVENT = 'canvas:focus-dock-page';

/** Ask the mounted RightDock owner to restore the last stable external focus. */
export const FOCUS_OUTSIDE_DOCK_EVENT = 'canvas:focus-outside-dock';

export interface DockPageKey {
  workspaceId: string;
  tabId: string;
}

let pendingPageFocus: DockPageKey | null = null;

/** Request focus for a user-selected browser page. The request survives a
 *  cold-load queue and is cancelled when the dock moves to another target. */
export function requestDockPageFocus(target: DockPageKey): void {
  pendingPageFocus = target;
  window.dispatchEvent(new CustomEvent(FOCUS_DOCK_PAGE_EVENT, { detail: target }));
}

/** Claim the latest user focus request when this exact workspace tab owns it. */
export function consumeDockPageFocusRequest(target: DockPageKey): boolean {
  if (!pendingPageFocus) return false;
  if (
    pendingPageFocus.workspaceId !== target.workspaceId
    || pendingPageFocus.tabId !== target.tabId
  ) return false;
  pendingPageFocus = null;
  return true;
}

export function cancelDockPageFocusRequest(): void {
  pendingPageFocus = null;
}

export function cancelDockPageFocusRequestUnless(target: DockPageKey | null): void {
  if (!pendingPageFocus) return;
  if (
    target
    && pendingPageFocus.workspaceId === target.workspaceId
    && pendingPageFocus.tabId === target.tabId
  ) return;
  pendingPageFocus = null;
}

export function dockPageKeyFromFocusEvent(event: Event): DockPageKey | null {
  const detail = (event as CustomEvent<Partial<DockPageKey>>).detail;
  if (!detail || typeof detail.workspaceId !== 'string' || typeof detail.tabId !== 'string') {
    return null;
  }
  return { workspaceId: detail.workspaceId, tabId: detail.tabId };
}

/** Browser tabs without a URL have chrome but no guest. Route those focus
 *  gestures to the omnibox; loaded tabs keep the durable page intent. */
export function focusDockLinkTarget(target: DockPageKey & { url: string }): void {
  if (!target.url) {
    cancelDockPageFocusRequest();
    // Let the initiating mousedown/click finish its native focus default
    // before moving into the omnibox; otherwise the tab button immediately
    // steals focus back after the synchronous handler returns.
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent(FOCUS_DOCK_ADDRESS_EVENT, {
        detail: { workspaceId: target.workspaceId, tabId: target.tabId },
      }));
    });
    return;
  }
  requestDockPageFocus({
    workspaceId: target.workspaceId,
    tabId: target.tabId,
  });
}

export const focusActiveDockTarget = (store: DockStore): void => {
  const next = store.getSnapshot();
  if (!next.expanded) {
    cancelDockPageFocusRequest();
    window.dispatchEvent(new Event(FOCUS_OUTSIDE_DOCK_EVENT));
    return;
  }
  const tab = next.tabs.find((item) => item.id === next.activeTabId);
  if (tab?.kind === 'link') {
    focusDockLinkTarget({
      workspaceId: next.activeTerminalWorkspaceId,
      tabId: tab.id,
      url: tab.url,
    });
    return;
  }
  cancelDockPageFocusRequest();
  const targetId = next.activeTabId;
  requestAnimationFrame(() => {
    const current = store.getSnapshot();
    if (!current.expanded || current.activeTabId !== targetId) return;
    document.getElementById(dockTabElementId(targetId))?.focus();
  });
};

const cycle = (ids: readonly string[], currentId: string, delta: number): string | undefined => {
  if (ids.length === 0) return undefined;
  const index = ids.indexOf(currentId);
  if (index === -1) return ids[0];
  return ids[(index + delta + ids.length) % ids.length];
};

const dispatchActiveLinkCommand = (eventName: string, state: DockState): boolean => {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  if (activeTab?.kind !== 'link') return false;
  const target: DockPageKey = {
    workspaceId: state.activeTerminalWorkspaceId,
    tabId: activeTab.id,
  };
  window.dispatchEvent(new CustomEvent(eventName, { detail: target }));
  return true;
};

/**
 * Apply a browsing command. Returns whether it was consumed, so the caller
 * can leave unhandled chords to the rest of the app.
 *
 * `newTabTitle` is passed in because the store is framework-free and must not
 * reach into the renderer's i18n.
 */
export function applyDockBrowserCommand(
  command: DockBrowserCommand,
  store: DockStore,
  state: DockState,
  newTabTitle: string,
  cycleTabIds: readonly string[] = state.tabs.map((tab) => tab.id),
): boolean {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  switch (command) {
    case 'new-tab':
      store.newLink(newTabTitle);
      return true;
    case 'reopen-tab':
      if (!store.canReopenClosedTab()) return false;
      store.reopenClosedTab();
      focusActiveDockTarget(store);
      return true;
    case 'close-tab':
      // Only content tabs close; the pinned chat tab has no close affordance
      // and a terminal tab owns a live PTY that ⌘W must not silently kill.
      if (!activeTab) return false;
      store.close(activeTab.id);
      focusActiveDockTarget(store);
      return true;
    case 'focus-address':
      return dispatchActiveLinkCommand(FOCUS_DOCK_ADDRESS_EVENT, state);
    case 'reload':
      return dispatchActiveLinkCommand(RELOAD_DOCK_TAB_EVENT, state);
    case 'find':
      return dispatchActiveLinkCommand(FIND_IN_DOCK_TAB_EVENT, state);
    case 'next-tab':
    case 'previous-tab': {
      const nextId = cycle(cycleTabIds, state.activeTabId, command === 'next-tab' ? 1 : -1);
      if (!nextId || nextId === state.activeTabId) return false;
      store.activate(nextId);
      focusActiveDockTarget(store);
      return true;
    }
    default:
      return false;
  }
}
