import { describe, expect, it, vi } from 'vitest';
import { DockStore, LINK_TAB_ID, artifactTabId } from '../dock-store';

describe('DockStore', () => {
  it('opens an artifact as a new active tab', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    const { tabs, activeTabId } = dock.getSnapshot();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ kind: 'artifact', workspaceId: 'ws1', artifactId: 'a1' });
    expect(activeTabId).toBe(artifactTabId('ws1', 'a1'));
  });

  it('re-activates instead of duplicating an already-open artifact', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.openArtifact('ws1', 'a2');
    dock.openArtifact('ws1', 'a1');
    const { tabs, activeTabId } = dock.getSnapshot();
    expect(tabs).toHaveLength(2);
    expect(activeTabId).toBe(artifactTabId('ws1', 'a1'));
  });

  it('keeps previous previews as background tabs (no eviction)', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.openLink('https://example.com');
    const { tabs, activeTabId } = dock.getSnapshot();
    expect(tabs.map((t) => t.kind)).toEqual(['artifact', 'link']);
    expect(activeTabId).toBe(LINK_TAB_ID);
  });

  it('keeps a single link tab: a new URL replaces it in place', () => {
    const dock = new DockStore();
    dock.openLink('https://a.example');
    dock.openArtifact('ws1', 'a1');
    dock.openLink('https://b.example');
    const { tabs, activeTabId } = dock.getSnapshot();
    expect(tabs).toHaveLength(2);
    const link = tabs.find((t) => t.kind === 'link');
    expect(link).toMatchObject({ id: LINK_TAB_ID, url: 'https://b.example', title: 'https://b.example' });
    // Replacement keeps the tab's original position.
    expect(tabs[0].kind).toBe('link');
    expect(activeTabId).toBe(LINK_TAB_ID);
  });

  it('re-opening the same URL just activates the link tab and keeps its title', () => {
    const dock = new DockStore();
    dock.openLink('https://a.example');
    dock.setTitle(LINK_TAB_ID, 'Page title');
    dock.openArtifact('ws1', 'a1');
    dock.openLink('https://a.example');
    const { tabs, activeTabId } = dock.getSnapshot();
    expect(activeTabId).toBe(LINK_TAB_ID);
    expect(tabs.find((t) => t.kind === 'link')?.title).toBe('Page title');
  });

  it('activate switches tabs and ignores unknown ids', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.openArtifact('ws1', 'a2');
    dock.activate(artifactTabId('ws1', 'a1'));
    expect(dock.getSnapshot().activeTabId).toBe(artifactTabId('ws1', 'a1'));
    dock.activate('nope');
    expect(dock.getSnapshot().activeTabId).toBe(artifactTabId('ws1', 'a1'));
  });

  it('closing an inactive tab keeps the active tab', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.openArtifact('ws1', 'a2');
    dock.close(artifactTabId('ws1', 'a1'));
    const { tabs, activeTabId } = dock.getSnapshot();
    expect(tabs).toHaveLength(1);
    expect(activeTabId).toBe(artifactTabId('ws1', 'a2'));
  });

  it('closing the active tab activates the right neighbour, else the new last tab', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.openArtifact('ws1', 'a2');
    dock.openArtifact('ws1', 'a3');
    dock.activate(artifactTabId('ws1', 'a2'));
    dock.close(artifactTabId('ws1', 'a2'));
    expect(dock.getSnapshot().activeTabId).toBe(artifactTabId('ws1', 'a3'));
    // a3 is active and last — closing it falls back to the new last tab (a1).
    dock.close(artifactTabId('ws1', 'a3'));
    expect(dock.getSnapshot().activeTabId).toBe(artifactTabId('ws1', 'a1'));
  });

  it('closing the last tab empties the dock', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.close(artifactTabId('ws1', 'a1'));
    expect(dock.getSnapshot()).toEqual({ tabs: [], activeTabId: null });
  });

  it('setTitle updates the tab label and ignores blank titles', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    const id = artifactTabId('ws1', 'a1');
    dock.setTitle(id, '进店意图 SQL 加工逻辑');
    expect(dock.getSnapshot().tabs[0].title).toBe('进店意图 SQL 加工逻辑');
    dock.setTitle(id, '   ');
    expect(dock.getSnapshot().tabs[0].title).toBe('进店意图 SQL 加工逻辑');
  });

  it('closeAll empties the dock', () => {
    const dock = new DockStore();
    dock.openArtifact('ws1', 'a1');
    dock.openLink('https://a.example');
    dock.closeAll();
    expect(dock.getSnapshot()).toEqual({ tabs: [], activeTabId: null });
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const dock = new DockStore();
    const listener = vi.fn();
    const unsubscribe = dock.subscribe(listener);
    dock.openArtifact('ws1', 'a1');
    expect(listener).toHaveBeenCalledTimes(1);
    // No-op operations must not notify (snapshot identity is the contract
    // useSyncExternalStore relies on).
    dock.activate(artifactTabId('ws1', 'a1'));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    dock.closeAll();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
