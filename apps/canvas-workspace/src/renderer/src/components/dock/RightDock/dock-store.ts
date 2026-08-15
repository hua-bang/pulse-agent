/** Framework-free state for the pinned chat plus preview/terminal tabs.
 * Owns activation, dedupe, the global link session and workspace terminal
 * projections, closing order, split pairing, and chat unread policy. React
 * binds with
 * `useSyncExternalStore` in components/dock/RightDock. */
import { CHAT_TAB_ID, artifactTabId, canvasPreviewTabId, isTerminalTabId, nodeDetailTabId } from './dock-tab-ids';
import {
  closeTerminalCommit,
  newTerminalCommit,
  openTerminalCommit,
  projectTerminalWorkspace,
  renameTerminalCommit,
  terminalWorkspaceFor,
  type TerminalCommit,
} from './dock-terminal-tabs';
import { DockLinkSessionStore, type DockLinkTab, type DockSessionPersistence } from './dock-link-sessions';
import { ClosedLinkTabStack, allocateTabId } from './dock-link-tabs';
import {
  getNavigateLinkPatch, getNewLinkPatch, getOpenLinkPatch,
  getSetFaviconPatch, getSetTitlePatch, getSyncLinkUrlPatch,
  type DockOpenLinkOptions,
} from './dock-link-commands';
import { reorderTabs, updateTerminalAgentType, type DockTabDropPosition } from './dock-tab-operations';
import { applyDockSplitState, getSplitViewToggle } from './dock-split-state';
import { isDockChatVisible } from './dock-visibility';
import { openSkillTab } from './dock-skill-tabs';
import { getOpenChatPatch, getOpenScheduledChatPatch, getRefreshScheduledChatPatch } from './dock-chat-state';
import { getToggleContentTabsPatch } from './dock-content-tabs';
import type { DockPreviewTab, DockState, DockTerminalTab, DockTerminalWorkspaceState } from './dock-types';
import type { CanvasConfigScope, CanvasSkillEntry } from '../../../types';
export { CHAT_TAB_ID, LINK_TAB_ID, TERMINAL_TAB_ID, artifactTabId, canvasPreviewTabId, isTerminalTabId, linkTabId, nodeDetailTabId, skillTabId, terminalTabId } from './dock-tab-ids';
export type { DockLinkSession, DockLinkSessions, DockLinkTab, DockSessionPersistence } from './dock-link-sessions';
export type { DockPreviewTab, DockState, DockTerminalTab, DockTerminalWorkspaceState } from './dock-types';
export type { DockOpenLinkOptions } from './dock-link-commands';
const DEFAULT_TERMINAL_WORKSPACE_ID = '__default__';
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
export class DockStore {
  private state: DockState;
  private listeners = new Set<() => void>();
  private nextLinkOrdinal = 1;
  private readonly linkSessions: DockLinkSessionStore;
  private readonly closedLinkTabs = new ClosedLinkTabStack();

  constructor(sessionPersistence?: DockSessionPersistence) {
    this.linkSessions = new DockLinkSessionStore(sessionPersistence);
    const globalSession = this.linkSessions.getGlobal();
    this.state = {
      ...INITIAL,
      tabs: globalSession.tabs,
      activeTabId: globalSession.activeTabId ?? globalSession.tabs[0]?.id ?? CHAT_TAB_ID,
      expanded: globalSession.expanded ?? false,
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = (): DockState => this.state;

  private commit(next: Partial<DockState>): void {
    const previous = this.state;
    this.state = applyDockSplitState(this.state, next);
    if (
      previous.tabs !== this.state.tabs
      || previous.activeTabId !== this.state.activeTabId
      || previous.expanded !== this.state.expanded
    ) this.persistActiveLinkSession();
    for (const listener of [...this.listeners]) listener();
  }

  private persistActiveLinkSession(): void {
    this.linkSessions.captureGlobal(this.state.tabs, this.state.activeTabId, this.state.expanded);
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
      ? projectTerminalWorkspace(terminalTabsByWorkspace, workspaceId)
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

  /** A node's full page and its dock preview are mutually exclusive. Remove
   * the duplicate preview, but only yield the dock width when that preview was
   * the active surface — an unrelated active tab remains visible. */
  enterNodePage(workspaceId: string, nodeId: string): void {
    const id = nodeDetailTabId(workspaceId, nodeId);
    const promotedActivePreview = this.state.expanded && this.state.activeTabId === id;
    this.close(id);
    if (promotedActivePreview) this.collapse();
  }

  openSkill(scope: CanvasConfigScope, skill: CanvasSkillEntry): void {
    this.commit({
      ...openSkillTab(this.state.tabs, scope, skill),
      expanded: true,
    });
  }

  /** Open a canvas preview tab. It defaults to read-only; the dedicated AI
   *  Chat host may grant a transient, explicit edit mode. Deduped
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
   *  canvas preview whose workspace just became mounted is closed, so
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

  /** Whether a canvas preview may be opened without violating one-writer. */
  canPreviewCanvas(workspaceId: string): boolean {
    return !this.state.mountedWorkspaceIds.has(workspaceId);
  }

  /** Open a URL as a web tab; see `dock-link-commands.ts` for the rules. */
  openLink(url: string, options: DockOpenLinkOptions = {}): void {
    const next = getOpenLinkPatch(this.state, url, options);
    if (!next) return;
    this.commit(next);
  }

  /**
   * Open a link on behalf of a mounted browser guest.
   *
   * The source workspace is only a focus hint now. Link tabs are global, so a
   * page opened by a hidden canvas is added to the same application-wide tab
   * strip instead of being written into a workspace session.
   */
  openLinkInWorkspace(
    workspaceId: string,
    url: string,
    options: DockOpenLinkOptions = {},
  ): void {
    this.openLink(url, {
      ...options,
      background: options.background ?? workspaceId !== this.state.activeTerminalWorkspaceId,
    });
  }

  /** Create an empty browser tab. */
  newLink(title = 'New tab'): void {
    this.commit(getNewLinkPatch(this.state, title, this.nextLinkOrdinal));
    this.nextLinkOrdinal += 1;
  }

  navigateLink(id: string, url: string): void {
    const next = getNavigateLinkPatch(this.state, id, url);
    if (!next) return;
    this.commit(next);
  }

  /** Mirror a guest URL without overwriting its resolved page title. */
  syncLinkUrl(id: string, url: string): void {
    const next = getSyncLinkUrlPatch(this.state, id, url);
    if (!next) return;
    this.commit(next);
  }

  /** Switch to an existing tab (chat, workspace terminal, or preview). Viewing chat clears unread. */
  activate(id: string): boolean {
    const activatingTerminal = this.state.terminalTabs.some((tab) => tab.id === id);
    if (
      id !== CHAT_TAB_ID
      && !activatingTerminal
      && !this.state.tabs.some((tab) => tab.id === id)
    ) {
      return false;
    }
    if (this.state.activeTabId === id && (id !== CHAT_TAB_ID || !this.state.chatUnread)) {
      return true;
    }
    if (activatingTerminal) {
      const workspaceId = this.state.activeTerminalWorkspaceId;
      const workspace = terminalWorkspaceFor(this.state.terminalTabsByWorkspace, workspaceId);
      this.commitTerminalWorkspace(workspaceId, { ...workspace, activeTabId: id }, {
        expanded: true,
        activeTabId: id,
      });
      return true;
    }
    this.commit({
      expanded: true,
      activeTabId: id,
      ...(id === CHAT_TAB_ID ? { chatUnread: false } : {}),
    });
    return true;
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
    const projection = projectTerminalWorkspace(this.state.terminalTabsByWorkspace, workspaceId);
    const switchingFromTerminal = isTerminalTabId(this.state.activeTabId);
    const activeTabId = (switchingFromTerminal ? projection.activeTerminalTabId : undefined)
      ?? (this.state.tabs.some((tab) => tab.id === this.state.activeTabId)
        ? this.state.activeTabId
        : undefined)
      ?? projection.activeTerminalTabId
      ?? this.state.tabs[0]?.id
      ?? CHAT_TAB_ID;
    this.commit({
      activeTerminalWorkspaceId: workspaceId,
      ...projection,
      activeTabId,
      ...(activeTabId === CHAT_TAB_ID ? { chatUnread: false } : {}),
    });
  }

  private applyTerminalCommit(commit: TerminalCommit | null, workspaceId: string): void {
    if (!commit) return;
    this.commitTerminalWorkspace(workspaceId, commit.workspace, commit.patch);
  }

  openTerminal(): void {
    const workspaceId = this.state.activeTerminalWorkspaceId;
    const workspace = terminalWorkspaceFor(this.state.terminalTabsByWorkspace, workspaceId);
    this.applyTerminalCommit(openTerminalCommit(this.state, workspace), workspaceId);
  }

  newTerminal(): void {
    const workspaceId = this.state.activeTerminalWorkspaceId;
    this.applyTerminalCommit(
      newTerminalCommit(terminalWorkspaceFor(this.state.terminalTabsByWorkspace, workspaceId)),
      workspaceId,
    );
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
    const workspace = terminalWorkspaceFor(this.state.terminalTabsByWorkspace, workspaceId);
    this.applyTerminalCommit(closeTerminalCommit(this.state, workspace, id), workspaceId);
  }

  renameTerminal(id: string, title: string): void {
    const workspaceId = this.state.activeTerminalWorkspaceId;
    const workspace = terminalWorkspaceFor(this.state.terminalTabsByWorkspace, workspaceId);
    this.applyTerminalCommit(renameTerminalCommit(workspace, id, title), workspaceId);
  }

  setTerminalAgentType(id: string, agentType?: string, workspaceId = this.state.activeTerminalWorkspaceId): void {
    const workspace = terminalWorkspaceFor(this.state.terminalTabsByWorkspace, workspaceId);
    const next = updateTerminalAgentType(workspace, id, agentType);
    if (next) this.commitTerminalWorkspace(workspaceId, next);
  }

  reorderTab(sourceId: string, targetId: string, position: DockTabDropPosition): void {
    const previewTabs = reorderTabs(this.state.tabs, sourceId, targetId, position);
    if (previewTabs) {
      this.commit({ tabs: previewTabs });
      return;
    }
    const workspaceId = this.state.activeTerminalWorkspaceId;
    const workspace = terminalWorkspaceFor(this.state.terminalTabsByWorkspace, workspaceId);
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
    const next = getSetTitlePatch(this.state, id, title);
    if (!next) return;
    this.commit(next);
  }

  /** Live favicon update once a link's webview reports the page icon. */
  setFavicon(id: string, faviconUrl: string): void {
    const next = getSetFaviconPatch(this.state, id, faviconUrl);
    if (!next) return;
    this.commit(next);
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
  }

  /** Whether `reopenClosedTab` has anything to restore in the global browser. */
  canReopenClosedTab(): boolean {
    return this.closedLinkTabs.has();
  }

  /** Restore the most recently closed web tab at the position it held. */
  reopenClosedTab(): void {
    const entry = this.closedLinkTabs.pop();
    if (!entry) return;
    const tabs = [...this.state.tabs];
    const restoredId = allocateTabId(tabs, entry.tab.id);
    const restoredTab = restoredId === entry.tab.id
      ? entry.tab
      : { ...entry.tab, id: restoredId };
    tabs.splice(Math.min(entry.index, tabs.length), 0, restoredTab);
    this.commit({ tabs, activeTabId: restoredId, expanded: true });
  }

  /** A chat turn finished while chat wasn't the visible tab → unread dot. */
  notifyChatActivity(): void {
    if (isDockChatVisible(this.state)) return;
    if (this.state.chatUnread) return;
    this.commit({ chatUnread: true });
  }
}
