import { useEffect } from 'react';
import { buildDockTabRefs } from './tabRefs';
import type { DockState, DockStore } from './dock-store';

/**
 * Bridges the right dock to the Canvas Agent:
 *  - listens for `canvas:activate-dock-tab` (emitted by tab-mention chips in
 *    chat) and activates the referenced tab;
 *  - publishes the active workspace's open tabs to main so the
 *    `canvas_list_tabs` agent tool can enumerate them.
 */
export function useDockAgentBridge(store: DockStore, state: DockState, activeWorkspaceId: string): void {
  useEffect(() => {
    const onJump = (e: Event) => {
      const tabId = (e as CustomEvent<{ tabId?: string }>).detail?.tabId;
      if (tabId) store.activate(tabId);
    };
    window.addEventListener('canvas:activate-dock-tab', onJump);
    return () => window.removeEventListener('canvas:activate-dock-tab', onJump);
  }, [store]);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    window.canvasWorkspace.dock.publishTabs(activeWorkspaceId, buildDockTabRefs(state, activeWorkspaceId));
  }, [state.tabs, state.terminalTabsByWorkspace, activeWorkspaceId]);
}
