import { useEffect, useRef } from 'react';
import type {
  DockActivateTabRequest,
  DockActivateTabResult,
} from '../../../../../shared/dock-tab-commands';
import type { AgentContextTabRef } from '../../../types';
import { buildDockTabRefs } from './tabRefs';
import type { DockState, DockStore } from './dock-store';
import { activateOrReopenDockTab, type DockTabActivationOutcome } from './dock-tab-reopen';

type LocalActivationResult = { status: DockTabActivationOutcome };
type PendingActivation = {
  workspaceId: string;
  tabId: string;
  tab?: AgentContextTabRef;
  finish: (outcome: DockTabActivationOutcome, error?: DockActivateTabResult['error']) => void;
  timeout: ReturnType<typeof setTimeout>;
};

interface LocalActivationDetail {
  tabId?: string;
  dockWorkspaceId?: string;
  tab?: AgentContextTabRef;
  respond?: (result: LocalActivationResult) => void;
}

/**
 * Bridges the right dock to the Canvas Agent:
 *  - listens for `canvas:activate-dock-tab` (emitted by tab-mention chips in
 *    chat) and activates the referenced tab;
 *  - listens for main-process dock commands (`dock:activate-tab` /
 *    `dock:open-tab`, sent by the `dock_open_tab` tool and the webview
 *    page-control plugin) and applies them to the store;
 *  - publishes the active workspace's open tabs to main so the
 *    `dock_list_tabs` agent tool can enumerate them.
 */
export function useDockAgentBridge(
  store: DockStore,
  state: DockState,
  activeWorkspaceId: string,
  onActivateWorkspace?: (workspaceId: string) => boolean | void,
): void {
  const pendingActivation = useRef<PendingActivation | null>(null);
  const queueActivation = (
    workspaceId: string,
    tabId: string,
    tab: AgentContextTabRef | undefined,
    finish: PendingActivation['finish'],
  ) => {
    const previous = pendingActivation.current;
    if (previous) {
      clearTimeout(previous.timeout);
      previous.finish('stale', 'superseded');
    }
    if (workspaceId === activeWorkspaceId) {
      const outcome = activateOrReopenDockTab(store, tabId, tab);
      finish(outcome, outcome === 'stale' ? 'stale' : undefined);
      return;
    }
    if (!onActivateWorkspace || onActivateWorkspace(workspaceId) === false) {
      finish('stale', 'workspace-unavailable');
      return;
    }
    const timeout = setTimeout(() => {
      const pending = pendingActivation.current;
      if (!pending || pending.workspaceId !== workspaceId || pending.tabId !== tabId) return;
      pendingActivation.current = null;
      pending.finish('stale', 'workspace-unavailable');
    }, 2_500);
    pendingActivation.current = { workspaceId, tabId, tab, finish, timeout };
  };

  useEffect(() => {
    const onJump = (e: Event) => {
      const detail = (e as CustomEvent<LocalActivationDetail>).detail;
      const tabId = detail?.tabId;
      if (!tabId) return;
      queueActivation(detail.dockWorkspaceId || activeWorkspaceId, tabId, detail.tab, (status) => {
        detail.respond?.({ status });
      });
    };
    window.addEventListener('canvas:activate-dock-tab', onJump);
    return () => window.removeEventListener('canvas:activate-dock-tab', onJump);
  }, [activeWorkspaceId, onActivateWorkspace, store]);

  useEffect(() => {
    const offActivate = window.canvasWorkspace.dock.onActivateTab((request: DockActivateTabRequest) => {
      if (!request.requestId || !request.workspaceId || !request.tabId) return;
      queueActivation(request.workspaceId, request.tabId, undefined, (status, error) => {
        const ok = status !== 'stale';
        window.canvasWorkspace.dock.reportTabActivation({
          ...request,
          ok,
          ...(!ok ? { error: error ?? 'stale' } : {}),
        });
      });
    });
    const offOpen = window.canvasWorkspace.dock.onOpenTab(({ url, tabId }) => {
      if (!url) return;
      if (tabId && store.getSnapshot().tabs.some((tab) => tab.id === tabId && tab.kind === 'link')) {
        store.navigateLink(tabId, url);
        store.activate(tabId);
        return;
      }
      // Unknown/absent tabId → open (or re-activate the URL-deduped) tab.
      store.openLink(url);
    });
    const offOpenArtifact = window.canvasWorkspace.dock.onOpenArtifact(({ workspaceId, artifactId }) => {
      if (!workspaceId || !artifactId) return;
      // workspaceId is the artifact's STORAGE scope (may be the global
      // `__global_chat__` sentinel) — the viewer fetches by that pair, so no
      // active-workspace gating here.
      store.openArtifact(workspaceId, artifactId);
    });
    return () => {
      offActivate();
      offOpen();
      offOpenArtifact();
    };
  }, [store, activeWorkspaceId, onActivateWorkspace]);

  useEffect(() => {
    const pending = pendingActivation.current;
    if (!pending || pending.workspaceId !== activeWorkspaceId) return;
    pendingActivation.current = null;
    clearTimeout(pending.timeout);
    const outcome = activateOrReopenDockTab(store, pending.tabId, pending.tab);
    pending.finish(outcome, outcome === 'stale' ? 'stale' : undefined);
  }, [store, state.tabs, state.terminalTabs, activeWorkspaceId]);

  useEffect(() => () => {
    const pending = pendingActivation.current;
    if (!pending) return;
    pendingActivation.current = null;
    clearTimeout(pending.timeout);
    pending.finish('stale', 'workspace-unavailable');
  }, []);

  useEffect(() => {
    if (!activeWorkspaceId) return;
    window.canvasWorkspace.dock.publishTabs(activeWorkspaceId, buildDockTabRefs(state, activeWorkspaceId));
  }, [state.tabs, state.terminalTabsByWorkspace, state.activeTabId, state.expanded, state.splitTabIds, activeWorkspaceId]);
}
