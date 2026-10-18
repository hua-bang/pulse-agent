import { useLayoutEffect } from 'react';
import { CHAT_TAB_ID, type DockStore } from './state/dock-store';

/**
 * The AI Chat page opens on its conversation alone: every entry, and every
 * Dock scope change while on the page, starts with the dock collapsed, and
 * the topbar "Tabs" button shows the scope's tabs. A Workspace's Canvas and
 * its AI Chat share one Dock scope, so leaving the page puts back what that
 * scope showed before the page collapsed it, e.g. the dock chat on Canvas.
 *
 * Call after the hook that switches the store's scope: layout effects run in
 * declaration order, so the snapshot and the restore see the page's scope.
 */
export function useChatPageDockEntry(store: DockStore, onChatPage: boolean, scopeId: string): void {
  useLayoutEffect(() => {
    if (!onChatPage) return;
    const before = store.getSnapshot();
    store.collapse();
    return () => {
      const current = store.getSnapshot();
      if (current.activeTerminalWorkspaceId !== before.activeTerminalWorkspaceId) return;
      if (!before.expanded) {
        store.collapse();
      } else if (before.activeTabId === CHAT_TAB_ID) {
        store.openChat();
      } else if (!store.activate(before.activeTabId)) {
        store.collapse();
      }
    };
  }, [onChatPage, scopeId, store]);
}
