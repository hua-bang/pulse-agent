/**
 * State store for the right dock's tabs. Evolution of the old
 * single-claim DockCoordinator: instead of a new preview evicting the
 * previous one, each preview occupies a tab and opening an existing one
 * re-activates its tab.
 *
 * Policies owned here (kept framework-free so they're unit-testable;
 * React binds via `useSyncExternalStore` in components/RightDock):
 *  - artifact tabs are deduped by (workspaceId, artifactId);
 *  - there is at most ONE link tab — a new link replaces its URL rather
 *    than adding a tab, because every <webview> owns a guest renderer
 *    process and stacking them per-URL would leak processes;
 *  - closing the active tab activates the tab that slides into its slot
 *    (right neighbour, falling back to the new last tab).
 */

export type DockTab =
  | { id: string; kind: 'artifact'; title: string; workspaceId: string; artifactId: string }
  | { id: string; kind: 'link'; title: string; url: string };

export interface DockState {
  tabs: DockTab[];
  activeTabId: string | null;
}

const EMPTY: DockState = { tabs: [], activeTabId: null };

export const artifactTabId = (workspaceId: string, artifactId: string): string =>
  `artifact:${workspaceId}:${artifactId}`;

export const LINK_TAB_ID = 'link';

export class DockStore {
  private state: DockState = EMPTY;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): DockState => this.state;

  private commit(next: DockState): void {
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  openArtifact(workspaceId: string, artifactId: string): void {
    const id = artifactTabId(workspaceId, artifactId);
    if (this.state.tabs.some((tab) => tab.id === id)) {
      this.activate(id);
      return;
    }
    const tab: DockTab = { id, kind: 'artifact', title: 'Artifact', workspaceId, artifactId };
    this.commit({ tabs: [...this.state.tabs, tab], activeTabId: id });
  }

  openLink(url: string): void {
    const existing = this.state.tabs.find(
      (tab): tab is Extract<DockTab, { kind: 'link' }> => tab.kind === 'link',
    );
    if (!existing) {
      const tab: DockTab = { id: LINK_TAB_ID, kind: 'link', title: url, url };
      this.commit({ tabs: [...this.state.tabs, tab], activeTabId: tab.id });
      return;
    }
    if (existing.url === url) {
      // Same page: keep the loaded webview (and its resolved title).
      this.activate(existing.id);
      return;
    }
    this.commit({
      tabs: this.state.tabs.map((tab) =>
        tab.kind === 'link' ? { ...tab, url, title: url } : tab,
      ),
      activeTabId: existing.id,
    });
  }

  activate(id: string): void {
    if (this.state.activeTabId === id) return;
    if (!this.state.tabs.some((tab) => tab.id === id)) return;
    this.commit({ ...this.state, activeTabId: id });
  }

  /** Live label update (artifact loaded, webview resolved a page title). */
  setTitle(id: string, title: string): void {
    const trimmed = title.trim();
    if (!trimmed) return;
    const tab = this.state.tabs.find((t) => t.id === id);
    if (!tab || tab.title === trimmed) return;
    this.commit({
      ...this.state,
      tabs: this.state.tabs.map((t) => (t.id === id ? { ...t, title: trimmed } : t)),
    });
  }

  close(id: string): void {
    const index = this.state.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const tabs = this.state.tabs.filter((tab) => tab.id !== id);
    let activeTabId = this.state.activeTabId;
    if (activeTabId === id) {
      activeTabId = tabs.length === 0 ? null : tabs[Math.min(index, tabs.length - 1)].id;
    }
    this.commit({ tabs, activeTabId });
  }

  closeAll(): void {
    if (this.state.tabs.length === 0) return;
    this.commit(EMPTY);
  }
}
