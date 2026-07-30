/** Framework-free state for the pinned chat plus preview/terminal tabs.
 * Owns activation, dedupe, workspace sessions, closing order, split pairing,
 * collapse retention, and chat unread policy. React binds with
 * `useSyncExternalStore` in components/RightDock. */
import { CHAT_TAB_ID, artifactTabId, canvasPreviewTabId, isTerminalTabId, nodeDetailTabId } from './dock-tab-ids';
import {
  closeTerminalCommit,
  newTerminalCommit,
  openTerminalCommit,
  renameTerminalCommit,
  type TerminalCommit,
} from './dock-terminal-tabs';
import { DockLinkSessionStore, type DockLinkTab, type DockSessionPersistence } from './dock-link-sessions';
import { ClosedLinkTabStack, blankLinkTabId, insertLinkTab, isSameOrigin, urlLinkTabId } from './dock-link-tabs';
import { reorderTabs, updateTerminalAgentType, type DockTabDropPosition } from './dock-tab-operations';
import { applyDockSplitState, getSplitViewToggle } from './dock-split-state';
import { isDockChatVisible } from './dock-visibility';
import { openSkillTab } from './dock-skill-tabs';
import { getOpenChatPatch, getOpenScheduledChatPatch, getRefreshScheduledChatPatch } from './dock-chat-state';
import { getToggleContentTabsPatch } from './dock-content-tabs';
import type { DockPreviewTab, DockState, DockTerminalTab, DockTerminalWorkspaceState } from './dock-types';
import type { CanvasConfigScope, CanvasSkillEntry } from '../../types';
export { CHAT_TAB_ID, LINK_TAB_ID, TERMINAL_TAB_ID, artifactTabId, canvasPreviewTabId, isTerminalTabId, linkTabId, nodeDetailTabId, skillTabId, terminalTabId } from './dock-tab-ids';
export type { DockLinkSession, DockLinkSessions, DockLinkTab, DockSessionPersistence } from './dock-link-sessions';
export type { DockPreviewTab, DockState, DockTerminalTab, DockTerminalWorkspaceState } from './dock-types';
const DEFAULT_TERMINAL_WORKSPACE_ID = '__default__';
const EMPTY_TERMINAL_TABS: DockTerminalTab[] = [];
const INITIAL: DockState = {
  tabs: [],
  activeTabId: CHAT_TAB_ID,
  expanded: false,
  chatUnread: false,
  terminalTabsByWorkspace: {},
  activeTerminalWorkspaceId: DEFAULT_TERMINAL_WORKSPACE_ID,
  terminalTabs: [],
  activeTerminalTabId: undefined,
  nextTerminalOrdinal: 1,
  terminalOpen: false,
  mountedWorkspaceIds: new Set<string>(),
};
export interface DockOpenLinkOptions {
  /** Open without stealing focus (⌘/Ctrl+click, middle-click). */
  background?: boolean;
  /** Tab the link was opened from, for placement next to its opener. */
  openerTabId?: string;
}

export class DockStore {
  private state: DockState = INITIAL;
  private listeners = new Set<() => void>();
  private nextLinkOrdinal = 1;
  private readonly linkSessions: DockLinkSessionStore;
  private readonly closedLinkTabs = new ClosedLinkTabStack();

  constructor(sessionPersistence?: DockSessionPersistence) {
    this.linkSessions = new DockLinkSessionStore(sessionPersistence);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = (): DockState => this.state;

  private commit(next: Partial<DockState>): void {
    this.state = applyDockSplitState(this.state, next);
    for (const listener of [...this.listeners]) listener();
  }

  private persistActiveLinkSession(): void {
    this.linkSessions.capture(
      this.state.activeTerminalWorkspaceId,
      this.state.tabs,
      this.state.activeTabId,
    );
  }

  private getTerminalWorkspace(workspaceId = this.state.activeTerminalWorkspaceId): DockTerminalWorkspaceState {
    return this.state.terminalTabsByWorkspace[workspaceId] ?? {
      tabs: EMPTY_TERMINAL_TABS,
      activeTabId: undefined,
      nextOrdinal: 1,
    };
  }

  private projectTerminalWorkspace(
    workspaceId = this.state.activeTerminalWorkspaceId,
    workspaces = this.state.terminalTabsByWorkspace,
  ): Pick<DockState, 'terminalTabs' | 'activeTerminalTabId' | 'nextTerminalOrdinal' | 'terminalOpen'> {
    const workspace = workspaces[workspaceId];
    const tabs = workspace?.tabs ?? EMPTY_TERMINAL_TABS;
    const activeTerminalTabId = workspace?.activeTabId && tabs.some((tab) => tab.id === workspace.activeTabId)
      ? workspace.activeTabId
      : tabs[0]?.id;
    return {
      terminalTabs: tabs,
      activeTerminalTabId,
      nextTerminalOrdinal: workspace?.nextOrdinal ?? 1,
      terminalOpen: tabs.length > 0,
    };
  }

  private commitTerminalWorkspace(
    workspaceId: string,
    workspace: DockTerminalWorkspaceState,
    next: Partial<DockState> = {},
  ): void {
    const terminalTabsByWorkspace = { ...this.state.terminalTabsByWorkspace };
    if (workspace.tabs.length > 0) {
      terminalTabsByWorkspace[workspaceId] = workspace;
    } else {
      delete terminalTabsByWorkspace[workspaceId];
    }
    const projection = workspaceId === this.state.activeTerminalWorkspaceId
      ? this.projectTerminalWorkspace(workspaceId, terminalTabsByWorkspace)
      : {};
    this.commit({ terminalTabsByWorkspace, ...projection, ...next });
  }

  openArtifact(workspaceId: string, artifactId: string): void {
    const id = artifactTabId(workspaceId, artifactId);
    if (this.state.tabs.some((tab) => tab.id === id)) {
      this.commit({ expanded: true, activeTabId: id });
      return;
    }
    const tab: DockPreviewTab = { id, kind: 'artifact', title: 'Artifact', workspaceId, artifactId };
    this.commit({ tabs: [...this.state.tabs, tab], activeTabId: id, expanded: true });
  }

  openNodeDetail(workspaceId: string, nodeId: string, title: string): void {
    const id = nodeDetailTabId(workspaceId, nodeId);
    const existing = this.state.tabs.find((tab) => tab.id === id);
    if (existing) {
      this.commit({
        tabs: this.state.tabs.map((tab) => (tab.id === id ? { ...tab, title } : tab)),
        activeTabId: id,
        expanded: true,
      });
      return;
    }
    const tab: DockPreviewTab = { id, kind: 'node-detail', title, workspaceId, nodeId };
    this.commit({ tabs: [...this.state.tabs, tab], activeTabId: id, expanded: true });
  }

  openSkill(scope: CanvasConfigScope, skill: CanvasSkillEntry): void {
    this.commit({
      ...openSkillTab(this.state.tabs, scope, skill),
      expanded: true,
    });
  }

  /** Open a read-only preview of a workspace's canvas as a dock tab. Deduped
   *  by workspace so re-opening the same canvas re-activates its tab. Returns
   *  false when refused (the workspace is live in the main Workbench). */
  openCanvasPreview(workspaceId: string, title: string): boolean {
    // Never preview a canvas that's already live in the main Workbench.
    if (this.state.mountedWorkspaceIds.has(workspaceId)) return false;
    const id = canvasPreviewTabId(workspaceId);
    const existing = this.state.tabs.find((tab) => tab.id === id);
    if (existing) {
      this.commit({
        tabs: this.state.tabs.map((tab) => (tab.id === id ? { ...tab, title } : tab)),
        activeTabId: id,
        expanded: true,
      });
      return true;
    }
    const tab: DockPreviewTab = { id, kind: 'canvas', title, workspaceId };
    this.commit({ tabs: [...this.state.tabs, tab], activeTabId: id, expanded: true });
    return true;
  }

  /** Publish the set of workspaces the main Workbench has mounted (live). Any
   *  read-only canvas preview whose workspace just became mounted is closed, so
   *  the same canvas is never both live and previewed at once. */
  setMountedWorkspaces(ids: Iterable<string>): void {
    const next = new Set(ids);
    const cur = this.state.mountedWorkspaceIds;
    if (next.size === cur.size && [...next].every((id) => cur.has(id))) return;
    this.commit({ mountedWorkspaceIds: next });
    for (const tab of this.state.tabs) {
      if (tab.kind === 'canvas' && next.has(tab.workspaceId)) this.close(tab.id);
    }
  }

  /** Whether a read-only canvas preview may be opened for this workspace. */
  canPreviewCanvas(workspaceId: string): boolean {
    return !this.state.mountedWorkspaceIds.has(workspaceId);
  }

  /**
   * Open a URL as a web tab. `background` keeps the user where they are —
   * ⌘/Ctrl+click and middle-click are explicit "queue this for later"
   * gestures, and foregrounding them steals the page being read. `openerTabId`
   * places the new tab next to the tab it came from.
   */
  openLink(url: string, { background = false, openerTabId }: DockOpenLinkOptions = {}): void {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    const existing = this.state.tabs.find(
      (tab): tab is DockLinkTab => tab.kind === 'link' && tab.url === trimmedUrl,
    );
    if (existing) {
      // Same page: keep the loaded webview (and its resolved title).
      this.commit({ expanded: true, ...(background ? {} : { activeTabId: existing.id }) });
      this.persistActiveLinkSession();
      return;
    }

    const id = urlLinkTabId(this.state.tabs, trimmedUrl);
    const tab: DockPreviewTab = {
      id,
      kind: 'link',
      title: trimmedUrl,
      url: trimmedUrl,
      ...(openerTabId ? { openerTabId } : {}),
    };
    this.commit({
      tabs: insertLinkTab(this.state.tabs, tab, openerTabId),
      ...(background ? {} : { activeTabId: id }),
      expanded: true,
    });
    this.persistActiveLinkSession();
  }

  /** Create an empty browser tab. Unlike openLink, blank tabs are never deduped. */
  newLink(title = 'New tab'): void {
    const id = blankLinkTabId(this.state.tabs, this.nextLinkOrdinal);
    this.nextLinkOrdinal += 1;
    const tab: DockPreviewTab = { id, kind: 'link', title, url: '' };
    this.commit({ tabs: [...this.state.tabs, tab], activeTabId: id, expanded: true });
    this.persistActiveLinkSession();
  }

  navigateLink(id: string, url: string): void {
    const trimmed = url.trim();
    const tab = this.state.tabs.find((item) => item.id === id);
    if (!trimmed || tab?.kind !== 'link') return;
    this.commit({
      tabs: this.state.tabs.map((item) => (
        item.id === id ? { ...item, url: trimmed, title: trimmed, faviconUrl: undefined } : item
      )),
    });
    this.persistActiveLinkSession();
  }

  /**
   * Mirror a guest URL without overwriting its resolved page title. The
   * favicon survives same-origin navigation: SPA route changes fire this on
   * every pushState but re-announce `page-favicon-updated` only when the icon
   * link actually changes, so clearing unconditionally left those tabs stuck
   * on the generic globe until a full reload.
   */
  syncLinkUrl(id: string, url: string): void {
    const trimmed = url.trim();
    const tab = this.state.tabs.find((item) => item.id === id);
    if (!trimmed || tab?.kind !== 'link' || tab.url === trimmed) return;
    const keepFavicon = isSameOrigin(tab.url, trimmed);
    this.commit({
      tabs: this.state.tabs.map((item) => (item.id === id
        ? { ...item, url: trimmed, ...(keepFavicon ? {} : { faviconUrl: undefined }) } : item)),
    });
    this.persistActiveLinkSession();
  }

  /** Switch to an existing tab (chat, workspace terminal, or preview). Viewing chat clears unread. */
  activate(id: string): void {
    const activatingTerminal = this.state.terminalTabs.some((tab) => tab.id === id);
    if (
      id !== CHAT_TAB_ID
      && !activatingTerminal
      && !this.state.tabs.some((tab) => tab.id === id)
    ) {
      return;
    }
    if (this.state.activeTabId === id && (id !== CHAT_TAB_ID || !this.state.chatUnread)) return;
    if (activatingTerminal) {
      const workspaceId = this.state.activeTerminalWorkspaceId;
      const workspace = this.getTerminalWorkspace(workspaceId);
      this.commitTerminalWorkspace(workspaceId, { ...workspace, activeTabId: id }, {
        expanded: true,
        activeTabId: id,
      });
      return;
    }
    this.commit({
      expanded: true,
      activeTabId: id,
      ...(id === CHAT_TAB_ID ? { chatUnread: false } : {}),
    });
    if (this.state.tabs.some((tab) => tab.id === id && tab.kind === 'link')) {
      this.persistActiveLinkSession();
    }
  }

  /** Pair the active content tab with the pinned Pulse AI pane. */
  toggleSplitView(): void { const next = getSplitViewToggle(this.state); if (next) this.commit(next); }

  openChat(): void { const next = getOpenChatPatch(this.state); if (next) this.commit(next); }

  /** Open Pulse AI on a scheduled task's dedicated chat scope. */
  openScheduledChat(taskId: string): void { const next = getOpenScheduledChatPatch(this.state, taskId); if (next) this.commit(next); }

  /** Reload the visible task conversation after its background run persists. */
  refreshScheduledChat(taskId: string): void { const next = getRefreshScheduledChatPatch(this.state, taskId); if (next) this.commit(next); }

  /** Full-page-chat control: show/hide the dock's content tabs. That route
   *  hides the pinned chat tab, so `toggleChat` cannot serve it. */
  toggleContentTabs(): void { const next = getToggleContentTabsPatch(this.state); if (next) this.commit(next); }

  /** Toolbar chat button: collapse when already looking at chat, else show chat. */
  toggleChat(): void {
    if (this.state.expanded && this.state.activeTabId === CHAT_TAB_ID) {
      this.collapse();
      return;
    }
    this.openChat();
  }

  setActiveWorkspace(workspaceId: string): void {
    if (!workspaceId || workspaceId === this.state.activeTerminalWorkspaceId) return;
    this.persistActiveLinkSession();
    const nonLinkTabs = this.state.tabs.filter((tab) => tab.kind !== 'link');
    const restoredSession = this.linkSessions.get(workspaceId);
    const restoredLinkTabs = restoredSession?.tabs ?? [];
    const tabs = [...nonLinkTabs, ...restoredLinkTabs];
    const projection = this.projectTerminalWorkspace(workspaceId);
    const switchingFromTerminal = isTerminalTabId(this.state.activeTabId);
    const restoredLinkId = restoredSession?.activeTabId
      && restoredLinkTabs.some((tab) => tab.id === restoredSession.activeTabId)
      ? restoredSession.activeTabId
      : restoredLinkTabs[0]?.id;
    const currentTabStillExists = tabs.some((tab) => tab.id === this.state.activeTabId);
    const activeTabId = restoredLinkId
      ?? (switchingFromTerminal ? projection.activeTerminalTabId : undefined)
      ?? (currentTabStillExists ? this.state.activeTabId : undefined)
      ?? projection.activeTerminalTabId
      ?? tabs[0]?.id
      ?? CHAT_TAB_ID;
    this.commit({
      activeTerminalWorkspaceId: workspaceId,
      tabs,
      ...projection,
      activeTabId,
      expanded: this.state.expanded,
      ...(activeTabId === CHAT_TAB_ID ? { chatUnread: false } : {}),
    });
  }

  private applyTerminalCommit(commit: TerminalCommit | null, workspaceId: string): void {
    if (!commit) return;
    this.commitTerminalWorkspace(workspaceId, commit.workspace, commit.patch);
  }

  openTerminal(): void {
    const workspaceId = this.state.activeTerminalWorkspaceId;
    const workspace = this.getTerminalWorkspace(workspaceId);
    this.applyTerminalCommit(openTerminalCommit(this.state, workspace), workspaceId);
  }

  newTerminal(): void {
    const workspaceId = this.state.activeTerminalWorkspaceId;
    this.applyTerminalCommit(newTerminalCommit(this.getTerminalWorkspace(workspaceId)), workspaceId);
  }

  toggleTerminal(): void {
    if (this.state.expanded && this.state.terminalTabs.some((tab) => tab.id === this.state.activeTabId)) {
      this.collapse();
      return;
    }
    this.openTerminal();
  }

  closeTerminal(id = this.state.activeTerminalTabId): void {
    if (!id) return;
    const workspaceId = this.state.activeTerminalWorkspaceId;
    const workspace = this.getTerminalWorkspace(workspaceId);
    this.applyTerminalCommit(closeTerminalCommit(this.state, workspace, id), workspaceId);
  }

  renameTerminal(id: string, title: string): void {
    const workspaceId = this.state.activeTerminalWorkspaceId;
    const workspace = this.getTerminalWorkspace(workspaceId);
    this.applyTerminalCommit(renameTerminalCommit(workspace, id, title), workspaceId);
  }

  setTerminalAgentType(id: string, agentType?: string, workspaceId = this.state.activeTerminalWorkspaceId): void {
    const next = updateTerminalAgentType(this.getTerminalWorkspace(workspaceId), id, agentType);
    if (next) this.commitTerminalWorkspace(workspaceId, next);
  }

  reorderTab(sourceId: string, targetId: string, position: DockTabDropPosition): void {
    const previewTabs = reorderTabs(this.state.tabs, sourceId, targetId, position);
    if (previewTabs) {
      this.commit({ tabs: previewTabs });
      this.persistActiveLinkSession();
      return;
    }
    const workspaceId = this.state.activeTerminalWorkspaceId;
    const workspace = this.getTerminalWorkspace(workspaceId);
    const terminalTabs = reorderTabs(workspace.tabs, sourceId, targetId, position);
    if (!terminalTabs) return;
    this.commitTerminalWorkspace(workspaceId, { ...workspace, tabs: terminalTabs });
  }

  /** Hide the dock; all tabs (and the active pointer) survive. */
  collapse(): void {
    if (!this.state.expanded) return;
    this.commit({ expanded: false });
  }

  /** Live label update (artifact loaded, webview resolved a page title). */
  setTitle(id: string, title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    const tab = this.state.tabs.find((t) => t.id === id);
    if (!tab || tab.title === trimmed) return;
    this.commit({
      tabs: this.state.tabs.map((t) => (t.id === id ? { ...t, title: trimmed } : t)),
    });
    if (tab.kind === 'link') this.persistActiveLinkSession();
  }

  /** Live favicon update once a link's webview reports the page icon, so the
   *  tab tracks the site instead of the generic globe. */
  setFavicon(id: string, faviconUrl: string): void {
    const trimmed = faviconUrl.trim();
    if (!trimmed) return;
    const tab = this.state.tabs.find((t) => t.id === id);
    if (!tab || tab.kind !== 'link' || tab.faviconUrl === trimmed) return;
    this.commit({
      tabs: this.state.tabs.map((t) =>
        (t.id === id && t.kind === 'link' ? { ...t, faviconUrl: trimmed } : t)),
    });
    this.persistActiveLinkSession();
  }

  close(id: string): void {
    const index = this.state.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const closed = this.state.tabs[index];
    const closingLink = closed.kind === 'link';
    // A web tab carries browsing state (history, scroll, sign-in); closing one
    // is the only destructive tab action, so keep it reopenable.
    if (closingLink) {
      this.closedLinkTabs.push({
        tab: closed as DockLinkTab,
        index,
        workspaceId: this.state.activeTerminalWorkspaceId,
      });
    }
    const tabs = this.state.tabs.filter((tab) => tab.id !== id);
    let activeTabId = this.state.activeTabId;
    let chatUnread = this.state.chatUnread;
    if (activeTabId === id) {
      activeTabId = tabs.length === 0 ? CHAT_TAB_ID : tabs[Math.min(index, tabs.length - 1)].id;
      if (activeTabId === CHAT_TAB_ID) chatUnread = false;
    }
    this.commit({
      tabs,
      activeTabId,
      chatUnread,
      ...(this.state.splitTabId === id ? { splitTabId: undefined } : {}),
    });
    if (closingLink) this.persistActiveLinkSession();
  }

  /** Whether `reopenClosedTab` has anything to restore in this workspace. */
  canReopenClosedTab(): boolean {
    return this.closedLinkTabs.has(this.state.activeTerminalWorkspaceId);
  }

  /** Restore the most recently closed web tab of the active workspace at the
   *  position it held, and focus it. No-op when the stack is empty. */
  reopenClosedTab(): void {
    const entry = this.closedLinkTabs.pop(this.state.activeTerminalWorkspaceId);
    if (!entry) return;
    const tabs = [...this.state.tabs];
    tabs.splice(Math.min(entry.index, tabs.length), 0, entry.tab);
    this.commit({ tabs, activeTabId: entry.tab.id, expanded: true });
    this.persistActiveLinkSession();
  }

  /** A chat turn finished while chat wasn't the visible tab → unread dot. */
  notifyChatActivity(): void {
    if (isDockChatVisible(this.state)) return;
    if (this.state.chatUnread) return;
    this.commit({ chatUnread: true });
  }
}
