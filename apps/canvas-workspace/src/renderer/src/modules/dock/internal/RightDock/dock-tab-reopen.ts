import type { AgentContextTabRef } from '../../../../types';
import type { DockStore } from './dock-store';

export type DockTabActivationOutcome = 'activated' | 'reopened' | 'stale';

function isSafeHistoricalLink(url: string): boolean {
  if (url === 'about:blank') return true;
  try {
    const protocol = new URL(url).protocol;
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Activate a live tab, or deterministically recreate a historical web tab
 * from the URL persisted in its Chat mention. Other kinds remain stale until
 * their backing resources have an equally safe restore contract.
 */
export function activateOrReopenDockTab(
  store: DockStore,
  tabId: string,
  tab?: AgentContextTabRef,
): DockTabActivationOutcome {
  if (store.activate(tabId)) return 'activated';
  if (
    tab?.id !== tabId
    || tab.kind !== 'link'
    || !tab.url
    || !isSafeHistoricalLink(tab.url)
  ) return 'stale';

  store.openLink(tab.url);
  const state = store.getSnapshot();
  const active = state.tabs.find((candidate) => candidate.id === state.activeTabId);
  return active?.kind === 'link' && active.url === tab.url ? 'reopened' : 'stale';
}

/** A citation from another scope opens a preview here, preserving the source
 * resource identity and the current conversation's Dock session. Never treat
 * a same-id terminal or browser in this scope as the cited live instance. */
export function previewReferencedDockTab(store: DockStore, tab?: AgentContextTabRef): DockTabActivationOutcome {
  if (!tab) return 'stale';
  if (tab.kind === 'link' && tab.url && isSafeHistoricalLink(tab.url)) {
    store.openLink(tab.url);
  } else if (tab.kind === 'artifact' && tab.workspaceId && tab.artifactId) {
    store.openArtifact(tab.workspaceId, tab.artifactId);
  } else if (tab.kind === 'node-detail' && tab.workspaceId && tab.nodeId) {
    store.openNodeDetail(tab.workspaceId, tab.nodeId, tab.title);
  } else if (tab.kind === 'canvas' && tab.workspaceId) {
    if (!store.openCanvasPreview(tab.workspaceId, tab.title)) return 'stale';
  } else {
    return 'stale';
  }
  return 'reopened';
}
