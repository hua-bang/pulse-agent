import type { DockPreviewTab, DockState } from '../state/dock-types';
import { CHAT_TAB_ID } from '../../../../../shared/dock/dock-tab-ids';
import { projectTerminalWorkspace } from '../state/dock-terminal-tabs';
import { updateRetainedLinkTabs } from './dock-link-tabs';

export type DockLinkTab = Extract<DockPreviewTab, { kind: 'link' }>;

export interface DockLinkSession {
  tabs: DockLinkTab[];
  activeTabId?: string;
  expanded?: boolean;
  /** Epoch ms each web tab was last the active tab, keyed by tab id. */
  lastActiveAt?: Record<string, number>;
}

export type DockLinkSessions = Record<string, DockLinkSession>;

export interface DockSessionPersistence {
  load: () => DockLinkSessions;
  save: (sessions: DockLinkSessions) => void;
}

export class DockLinkSessionStore {
  private sessions: DockLinkSessions;
  /** Last active tab per workspace, as captured while that workspace was on screen. */
  private onScreenTabIds = new Map<string, string>();
  /** Last-use times of non-web tabs. They are not saved, so neither are their times. */
  private previewTimes = new Map<string, Record<string, number>>();
  // Full in-memory views are scope-owned; only reconstructible web tabs are
  // written to storage. Keep mixed tab order and the actual focused pane.
  private views = new Map<string, Pick<DockState,
    'tabs' | 'activeTabId' | 'splitTabIds' | 'chatUnread' | 'scheduledChatTaskId' | 'scheduledChatSessionId' | 'scheduledChatRevision'
  >>();

  removePreview(id: string): void {
    for (const view of this.views.values()) view.tabs = view.tabs.filter(tab => tab.id !== id);
  }

  switchWorkspace(state: DockState, workspaceId: string): Partial<DockState> {
    const leavingId = state.activeTerminalWorkspaceId;
    this.capture(leavingId, state.tabs, state.activeTabId, state.expanded);
    // Its tabs leave the screen now; nothing there is visible until re-entry.
    this.onScreenTabIds.delete(leavingId);
    this.views.set(leavingId, {
      tabs: state.tabs, activeTabId: state.activeTabId, splitTabIds: state.splitTabIds,
      chatUnread: state.chatUnread, scheduledChatTaskId: state.scheduledChatTaskId,
      scheduledChatSessionId: state.scheduledChatSessionId,
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
      scheduledChatSessionId: view?.scheduledChatSessionId,
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

  /** When each tab of a workspace was last active (epoch ms by tab id). */
  getTabActivity(workspaceId: string): Record<string, number> {
    return { ...this.previewTimes.get(workspaceId), ...this.sessions[workspaceId]?.lastActiveAt };
  }

  /**
   * Record a workspace's web tabs. `onScreen` is false for writes from a
   * hidden workspace's guest (title, icon, background open): they keep the
   * saved times, so a background page cannot postpone its own cleanup.
   */
  capture(workspaceId: string, tabs: DockPreviewTab[], activeTabId: string, expanded?: boolean, onScreen = true): void {
    if (!workspaceId || workspaceId === '__default__') return;
    const linkTabs = tabs.filter((tab): tab is DockLinkTab => tab.kind === 'link');
    const previous = this.sessions[workspaceId];
    const activeLinkId = linkTabs.some((tab) => tab.id === activeTabId)
      ? activeTabId
      : previous?.activeTabId && linkTabs.some((tab) => tab.id === previous.activeTabId)
        ? previous.activeTabId
        : undefined;
    // Stamp the tab on screen, and the one it replaced: that tab was visible
    // until now. A new tab counts as used when it opens.
    const now = Date.now();
    const shownTabId = this.onScreenTabIds.get(workspaceId);
    if (onScreen) this.onScreenTabIds.set(workspaceId, activeTabId);
    const stamp = (id: string, previousAt: number | undefined): number => (
      onScreen && [activeTabId, shownTabId].includes(id) ? now : previousAt ?? now
    );
    const lastActiveAt = Object.fromEntries(linkTabs.map((tab) => [tab.id, stamp(tab.id, previous?.lastActiveAt?.[tab.id])]));
    // Hidden-workspace writes carry only web tabs; keep the other times as they are.
    if (onScreen) {
      const previousTimes = this.previewTimes.get(workspaceId);
      this.previewTimes.set(workspaceId, Object.fromEntries(tabs
        .filter((tab) => tab.kind !== 'link')
        .map((tab) => [tab.id, stamp(tab.id, previousTimes?.[tab.id])])));
    }
    this.sessions = {
      ...this.sessions,
      [workspaceId]: {
        tabs: linkTabs,
        activeTabId: activeLinkId,
        expanded: expanded ?? previous?.expanded,
        lastActiveAt,
      },
    };
    try {
      this.persistence?.save(this.sessions);
    } catch {
      // Restoration is best-effort; unavailable storage must not break the dock.
    }
  }
}
