/**
 * Renderer-side glue for the shared web-tab keyboard policy
 * (`shared/dock-shortcuts.ts`): the command→store mapping used by both the
 * host-window listener and the main-process relay for keys pressed inside a
 * guest page.
 */
import type { DockBrowserCommand } from '../../../../shared/dock-shortcuts';
import type { DockState, DockStore } from './dock-store';

/** Window event asking the visible web tab to focus its address bar. */
export const FOCUS_DOCK_ADDRESS_EVENT = 'canvas:focus-dock-address';

/** Window event asking the visible web tab to reload. */
export const RELOAD_DOCK_TAB_EVENT = 'canvas:reload-dock-tab';

const cycle = (ids: readonly string[], currentId: string, delta: number): string | undefined => {
  if (ids.length === 0) return undefined;
  const index = ids.indexOf(currentId);
  if (index === -1) return ids[0];
  return ids[(index + delta + ids.length) % ids.length];
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
): boolean {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  switch (command) {
    case 'new-tab':
      store.newLink(newTabTitle);
      return true;
    case 'reopen-tab':
      if (!store.canReopenClosedTab()) return false;
      store.reopenClosedTab();
      return true;
    case 'close-tab':
      // Only content tabs close; the pinned chat tab has no close affordance
      // and a terminal tab owns a live PTY that ⌘W must not silently kill.
      if (!activeTab) return false;
      store.close(activeTab.id);
      return true;
    case 'focus-address':
      if (activeTab?.kind !== 'link') return false;
      window.dispatchEvent(new CustomEvent(FOCUS_DOCK_ADDRESS_EVENT));
      return true;
    case 'reload':
      if (activeTab?.kind !== 'link') return false;
      window.dispatchEvent(new CustomEvent(RELOAD_DOCK_TAB_EVENT));
      return true;
    case 'next-tab':
    case 'previous-tab': {
      const ids = state.tabs.map((tab) => tab.id);
      const nextId = cycle(ids, state.activeTabId, command === 'next-tab' ? 1 : -1);
      if (!nextId || nextId === state.activeTabId) return false;
      store.activate(nextId);
      return true;
    }
    default:
      return false;
  }
}
