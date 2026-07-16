/**
 * State store for the right dock — the tabbed right-side panel whose first
 * tab is the (pinned, non-closable) chat. Preview surfaces open as
 * additional tabs; with no previews the tab strip is hidden and the dock
 * looks like a plain chat panel.
 *
 * Policies owned here (kept framework-free so they're unit-testable;
 * React binds via `useSyncExternalStore` in components/RightDock):
 *  - chat is implicit/pinned: `tabs` holds preview tabs only and
 *    `activeTabId` is either `CHAT_TAB_ID` or a preview tab id;
 *  - artifact tabs are deduped by (workspaceId, artifactId);
 *  - link tabs are deduped by exact URL, while different URLs can stay
 *    open side by side as separate previews;
 *  - closing the active preview activates the tab that slides into its
 *    slot (right neighbour, falling back to the last preview, then chat);
 *  - collapsing the dock keeps all tabs — expanding restores them;
 *  - chat activity while chat is not visible sets an unread flag,
 *    cleared the moment chat becomes the active visible tab.
 */

export type DockPreviewTab =
  | { id: string; kind: 'artifact'; title: string; workspaceId: string; artifactId: string }
  | { id: string; kind: 'link'; title: string; url: string; faviconUrl?: string }
  | { id: string; kind: 'node-detail'; title: string; workspaceId: string; nodeId: string }
  | { id: string; kind: 'canvas'; title: string; workspaceId: string };

export interface DockTerminalTab {
  id: string;
  title?: string;
  ordinal: number;
  agentType?: string;
}

export interface DockTerminalWorkspaceState {
  tabs: DockTerminalTab[];
  activeTabId?: string;
  nextOrdinal: number;
}

export interface DockState {
  /** Preview tabs only — chat is pinned and implicit. */
  tabs: DockPreviewTab[];
  /** `CHAT_TAB_ID`, a terminal tab id, or a preview tab id. */
  activeTabId: string;
  expanded: boolean;
  chatUnread: boolean;
  terminalTabsByWorkspace: Record<string, DockTerminalWorkspaceState>;
  activeTerminalWorkspaceId: string;
  terminalTabs: DockTerminalTab[];
  activeTerminalTabId?: string;
  nextTerminalOrdinal: number;
  /** Compatibility flag for callers that only need to know whether any terminal exists. */
  terminalOpen: boolean;
}

export const CHAT_TAB_ID = 'chat';
export const TERMINAL_TAB_ID = 'terminal';
export const LINK_TAB_ID = 'link';
const DEFAULT_TERMINAL_WORKSPACE_ID = '__default__';
const EMPTY_TERMINAL_TABS: DockTerminalTab[] = [];

export const terminalTabId = (ordinal: number): string =>
  ordinal === 1 ? TERMINAL_TAB_ID : `${TERMINAL_TAB_ID}:${ordinal}`;

export const isTerminalTabId = (id: string): boolean =>
  id === TERMINAL_TAB_ID || id.startsWith(`${TERMINAL_TAB_ID}:`);

export const artifactTabId = (workspaceId: string, artifactId: string): string =>
  `artifact:${workspaceId}:${artifactId}`;

export const nodeDetailTabId = (workspaceId: string, nodeId: string): string =>
  `node-detail:${encodeURIComponent(workspaceId)}:${encodeURIComponent(nodeId)}`;

export const canvasPreviewTabId = (workspaceId: string): string =>
  `canvas:${encodeURIComponent(workspaceId)}`;

export const linkTabId = (url: string): string => {
  let hash = 2166136261;
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${LINK_TAB_ID}:${url.length.toString(36)}:${(hash >>> 0).toString(36)}`;
};

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
};

export class DockStore {
  private state: DockState = INITIAL;
  private listeners = new Set<() => void>();
  private nextLinkOrdinal = 1;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DockState => this.state;

  private commit(next: Partial<DockState>): void {
    this.state = { ...this.state, ...next };
    for (const listener of [...this.listeners]) listener();
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

  /** Open a read-only preview of a workspace's canvas as a dock tab. Deduped
   *  by workspace so re-opening the same canvas re-activates its tab. */
  openCanvasPreview(workspaceId: string, title: string): void {
    const id = canvasPreviewTabId(workspaceId);
    const existing = this.state.tabs.find((tab) => tab.id === id);
    if (existing) {
      this.commit({
        tabs: this.state.tabs.map((tab) => (tab.id === id ? { ...tab, title } : tab)),
        activeTabId: id,
        expanded: true,
      });
      return;
    }
    const tab: DockPreviewTab = { id, kind: 'canvas', title, workspaceId };
    this.commit({ tabs: [...this.state.tabs, tab], activeTabId: id, expanded: true });
  }

  openLink(url: string): void {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    const existing = this.state.tabs.find(
      (tab): tab is Extract<DockPreviewTab, { kind: 'link' }> =>
        tab.kind === 'link' && tab.url === trimmedUrl,
    );
    if (existing) {
      // Same page: keep the loaded webview (and its resolved title).
      this.commit({ expanded: true, activeTabId: existing.id });
      return;
    }

    const baseId = linkTabId(trimmedUrl);
    let id = baseId;
    let suffix = 2;
    while (this.state.tabs.some((tab) => tab.id === id)) {
      id = `${baseId}:${suffix}`;
      suffix += 1;
    }
    const tab: DockPreviewTab = { id, kind: 'link', title: trimmedUrl, url: trimmedUrl };
    this.commit({ tabs: [...this.state.tabs, tab], activeTabId: tab.id, expanded: true });
  }

  /** Create an empty browser tab. Unlike openLink, blank tabs are never deduped. */
  newLink(title = 'New tab'): void {
    let id = `${LINK_TAB_ID}:new:${this.nextLinkOrdinal}`;
    this.nextLinkOrdinal += 1;
    while (this.state.tabs.some((tab) => tab.id === id)) {
      id = `${LINK_TAB_ID}:new:${this.nextLinkOrdinal}`;
      this.nextLinkOrdinal += 1;
    }
    const tab: DockPreviewTab = { id, kind: 'link', title, url: '' };
    this.commit({ tabs: [...this.state.tabs, tab], activeTabId: id, expanded: true });
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
  }

  openChat(): void {
    if (this.state.expanded && this.state.activeTabId === CHAT_TAB_ID && !this.state.chatUnread) return;
    this.commit({ expanded: true, activeTabId: CHAT_TAB_ID, chatUnread: false });
  }

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
    const projection = this.projectTerminalWorkspace(workspaceId);
    const switchingFromTerminal = isTerminalTabId(this.state.activeTabId);
    const activeTabId = switchingFromTerminal
      ? (projection.activeTerminalTabId ?? this.state.tabs[0]?.id ?? CHAT_TAB_ID)
      : this.state.activeTabId;
    this.commit({
      activeTerminalWorkspaceId: workspaceId,
      ...projection,
      activeTabId,
      expanded: this.state.expanded,
      ...(activeTabId === CHAT_TAB_ID ? { chatUnread: false } : {}),
    });
  }

  private createTerminalTab(workspace: DockTerminalWorkspaceState): DockTerminalTab {
    const ordinal = workspace.nextOrdinal;
    return {
      id: terminalTabId(ordinal),
      ordinal,
    };
  }

  openTerminal(): void {
    const workspaceId = this.state.activeTerminalWorkspaceId;
    const workspace = this.getTerminalWorkspace(workspaceId);
    const currentTerminalId = workspace.activeTabId
      && workspace.tabs.some((tab) => tab.id === workspace.activeTabId)
      ? workspace.activeTabId
      : workspace.tabs[0]?.id;

    if (currentTerminalId) {
      if (this.state.expanded && this.state.activeTabId === currentTerminalId) return;
      this.commitTerminalWorkspace(workspaceId, { ...workspace, activeTabId: currentTerminalId }, {
        expanded: true,
        activeTabId: currentTerminalId,
      });
      return;
    }

    const tab = this.createTerminalTab(workspace);
    this.commitTerminalWorkspace(workspaceId, {
      tabs: [tab],
      activeTabId: tab.id,
      nextOrdinal: workspace.nextOrdinal + 1,
    }, {
      activeTabId: tab.id,
      expanded: true,
    });
  }

  newTerminal(): void {
    const workspaceId = this.state.activeTerminalWorkspaceId;
    const workspace = this.getTerminalWorkspace(workspaceId);
    const tab = this.createTerminalTab(workspace);
    this.commitTerminalWorkspace(workspaceId, {
      tabs: [...workspace.tabs, tab],
      activeTabId: tab.id,
      nextOrdinal: workspace.nextOrdinal + 1,
    }, {
      activeTabId: tab.id,
      expanded: true,
    });
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
    const index = workspace.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const terminalTabs = workspace.tabs.filter((tab) => tab.id !== id);
    const closingActiveTerminal = this.state.activeTabId === id;
    const activeTerminalTabId = terminalTabs[Math.min(index, terminalTabs.length - 1)]?.id
      ?? terminalTabs[terminalTabs.length - 1]?.id;
    const activeTabId = closingActiveTerminal
      ? (activeTerminalTabId ?? this.state.tabs[0]?.id ?? CHAT_TAB_ID)
      : this.state.activeTabId;
    this.commitTerminalWorkspace(workspaceId, {
      tabs: terminalTabs,
      activeTabId: activeTerminalTabId,
      nextOrdinal: workspace.nextOrdinal,
    }, {
      activeTabId,
      expanded: closingActiveTerminal && terminalTabs.length === 0 && this.state.tabs.length === 0
        ? false
        : this.state.expanded,
      ...(activeTabId === CHAT_TAB_ID ? { chatUnread: false } : {}),
    });
  }

  renameTerminal(id: string, title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    const workspaceId = this.state.activeTerminalWorkspaceId;
    const workspace = this.getTerminalWorkspace(workspaceId);
    const tab = workspace.tabs.find((item) => item.id === id);
    if (!tab || tab.title === trimmed) return;
    this.commitTerminalWorkspace(workspaceId, {
      ...workspace,
      tabs: workspace.tabs.map((item) =>
        (item.id === id ? { ...item, title: trimmed } : item)),
    });
  }

  setTerminalAgentType(id: string, agentType?: string, workspaceId = this.state.activeTerminalWorkspaceId): void {
    const trimmed = agentType?.trim();
    const workspace = this.getTerminalWorkspace(workspaceId);
    const tab = workspace.tabs.find((item) => item.id === id);
    if (!tab || tab.agentType === trimmed) return;
    this.commitTerminalWorkspace(workspaceId, {
      ...workspace,
      tabs: workspace.tabs.map((item) => {
        if (item.id !== id) return item;
        if (!trimmed) {
          const next = { ...item };
          delete next.agentType;
          return next;
        }
        return { ...item, agentType: trimmed };
      }),
    });
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
  }

  close(id: string): void {
    const index = this.state.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const tabs = this.state.tabs.filter((tab) => tab.id !== id);
    let activeTabId = this.state.activeTabId;
    let chatUnread = this.state.chatUnread;
    if (activeTabId === id) {
      activeTabId = tabs.length === 0 ? CHAT_TAB_ID : tabs[Math.min(index, tabs.length - 1)].id;
      if (activeTabId === CHAT_TAB_ID) chatUnread = false;
    }
    this.commit({ tabs, activeTabId, chatUnread });
  }

  /** A chat turn finished while chat wasn't the visible tab → unread dot. */
  notifyChatActivity(): void {
    if (this.state.expanded && this.state.activeTabId === CHAT_TAB_ID) return;
    if (this.state.chatUnread) return;
    this.commit({ chatUnread: true });
  }
}
