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
  | { id: string; kind: 'link'; title: string; url: string };

export interface DockState {
  /** Preview tabs only — chat is pinned and implicit. */
  tabs: DockPreviewTab[];
  /** `CHAT_TAB_ID` or a preview tab id. */
  activeTabId: string;
  expanded: boolean;
  chatUnread: boolean;
}

export const CHAT_TAB_ID = 'chat';
export const LINK_TAB_ID = 'link';

export const artifactTabId = (workspaceId: string, artifactId: string): string =>
  `artifact:${workspaceId}:${artifactId}`;

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
};

export class DockStore {
  private state: DockState = INITIAL;
  private listeners = new Set<() => void>();

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

  openArtifact(workspaceId: string, artifactId: string): void {
    const id = artifactTabId(workspaceId, artifactId);
    if (this.state.tabs.some((tab) => tab.id === id)) {
      this.commit({ expanded: true, activeTabId: id });
      return;
    }
    const tab: DockPreviewTab = { id, kind: 'artifact', title: 'Artifact', workspaceId, artifactId };
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

  /** Switch to an existing tab (chat or preview). Viewing chat clears unread. */
  activate(id: string): void {
    if (id !== CHAT_TAB_ID && !this.state.tabs.some((tab) => tab.id === id)) return;
    if (this.state.activeTabId === id && (id !== CHAT_TAB_ID || !this.state.chatUnread)) return;
    this.commit({
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
