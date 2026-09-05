import type { DockPreviewTab, DockState } from './dock-types';
import { CHAT_TAB_ID } from '../../../../shared/dock/dock-tab-ids';
import { projectTerminalWorkspace } from './dock-terminal-tabs';
import { updateRetainedLinkTabs } from './dock-link-tabs';

export type DockLinkTab = Extract<DockPreviewTab, { kind: 'link' }>;

export interface DockLinkSession {
  tabs: DockLinkTab[];
  activeTabId?: string;
  expanded?: boolean;
}

export type DockLinkSessions = Record<string, DockLinkSession>;

export interface DockSessionPersistence {
  load: () => DockLinkSessions;
  save: (sessions: DockLinkSessions) => void;
}

export class DockLinkSessionStore {
  private sessions: DockLinkSessions;
  // Full in-memory views are scope-owned; only reconstructible web tabs are
  // written to storage. Keep mixed tab order and the actual focused pane.
  private views = new Map<string, Pick<DockState,
    'tabs' | 'activeTabId' | 'splitTabIds' | 'chatUnread' | 'scheduledChatTaskId' | 'scheduledChatRevision'
  >>();

  removePreview(id: string): void {
    for (const view of this.views.values()) view.tabs = view.tabs.filter(tab => tab.id !== id);
  }

  switchWorkspace(state: DockState, workspaceId: string): Partial<DockState> {
    const leavingId = state.activeTerminalWorkspaceId;
    this.capture(leavingId, state.tabs, state.activeTabId, state.expanded);
    this.views.set(leavingId, {
      tabs: state.tabs, activeTabId: state.activeTabId, splitTabIds: state.splitTabIds,
      chatUnread: state.chatUnread, scheduledChatTaskId: state.scheduledChatTaskId,
      scheduledChatRevision: state.scheduledChatRevision,
    });
    const retainedLinkTabs = updateRetainedLinkTabs(state.retainedLinkTabs, {
      workspaceId: leavingId,
      tabs: state.tabs.filter((tab): tab is DockLinkTab => tab.kind === 'link'),
      activeTabId: state.activeTabId,
    }, workspaceId);
    // Hidden guests may have navigated or opened a new tab since leaving.
    const persisted = this.get(workspaceId);
    const links = state.retainedLinkTabs.find(entry => entry.workspaceId === workspaceId) ?? persisted;
    const view = this.views.get(workspaceId);
    const remainingLinks = new Map((links?.tabs ?? []).map(tab => [tab.id, tab]));
    const tabs = (view?.tabs ?? []).flatMap<DockPreviewTab>(tab => {
      if (tab.kind === 'canvas' && state.mountedWorkspaceIds.has(tab.workspaceId)) return [];
      if (tab.kind !== 'link') return [tab];
      const live = remainingLinks.get(tab.id);
      remainingLinks.delete(tab.id);
      return live ? [live] : [];
    });
    tabs.push(...remainingLinks.values());
    const projection = projectTerminalWorkspace(state.terminalTabsByWorkspace, workspaceId);
    const exists = (id: string | undefined): id is string => Boolean(id && (
      id === CHAT_TAB_ID || tabs.some(tab => tab.id === id) || projection.terminalTabs.some(tab => tab.id === id)
    ));
    const activeTabId = [view?.activeTabId, links?.activeTabId, tabs[0]?.id, projection.activeTerminalTabId]
      .find(exists) ?? CHAT_TAB_ID;
    return {
      activeTerminalWorkspaceId: workspaceId, tabs, retainedLinkTabs, ...projection,
      activeTabId, expanded: persisted?.expanded ?? false,
      splitTabIds: view?.splitTabIds,
      chatUnread: activeTabId === CHAT_TAB_ID ? false : view?.chatUnread ?? false,
      scheduledChatTaskId: view?.scheduledChatTaskId,
      scheduledChatRevision: view?.scheduledChatRevision,
    };
  }

  constructor(private readonly persistence?: DockSessionPersistence) {
    try {
      this.sessions = persistence?.load() ?? {};
    } catch {
      this.sessions = {};
    }
  }

  get(workspaceId: string): DockLinkSession | undefined {
    return this.sessions[workspaceId];
  }

  capture(workspaceId: string, tabs: DockPreviewTab[], activeTabId: string, expanded?: boolean): void {
    if (!workspaceId || workspaceId === '__default__') return;
    const linkTabs = tabs.filter((tab): tab is DockLinkTab => tab.kind === 'link');
    const previous = this.sessions[workspaceId];
    const activeLinkId = linkTabs.some((tab) => tab.id === activeTabId)
      ? activeTabId
      : previous?.activeTabId && linkTabs.some((tab) => tab.id === previous.activeTabId)
        ? previous.activeTabId
        : undefined;
    this.sessions = {
      ...this.sessions,
      [workspaceId]: {
        tabs: linkTabs,
        activeTabId: activeLinkId,
        expanded: expanded ?? previous?.expanded,
      },
    };
    try {
      this.persistence?.save(this.sessions);
    } catch {
      // Restoration is best-effort; unavailable storage must not break the dock.
    }
  }
}
