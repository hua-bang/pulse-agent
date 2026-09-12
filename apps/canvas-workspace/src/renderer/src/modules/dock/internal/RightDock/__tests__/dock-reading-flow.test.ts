import { describe, expect, it } from 'vitest';
import { getRenderableComparisonPair } from '../../../../../shared/dock/dock-split-state';
import { DockStore, CHAT_TAB_ID } from '../dock-store';

describe('pinned comparison browsing', () => {
  it('keeps content comparison on full-page chat but excludes its duplicate AI pane', () => {
    const store = new DockStore();
    store.openLink('https://a.example');
    store.toggleSplitView();
    expect(getRenderableComparisonPair(store.getSnapshot(), false)).toBeUndefined();
    expect(getRenderableComparisonPair(store.getSnapshot(), true)).toBeDefined();
    store.openLink('https://b.example');
    store.placeTab(store.getSnapshot().tabs[0].id, 'right');
    expect(getRenderableComparisonPair(store.getSnapshot(), false)).toEqual(store.getSnapshot().splitTabIds);
  });
  it('places a reference explicitly, keeps it while browsing and exits on the left', () => {
    const store = new DockStore();
    store.openLink('https://a.example');
    const a = store.getSnapshot().activeTabId;
    store.openLink('https://b.example');
    const b = store.getSnapshot().activeTabId;
    store.activate(a);
    store.placeTab(b, 'right');
    store.openLink('https://c.example');
    const c = store.getSnapshot().activeTabId;
    expect(store.getSnapshot().splitTabIds).toEqual([c, b]);
    store.activate(b);
    store.toggleSplitView();
    expect(store.getSnapshot().activeTabId).toBe(c);
    expect(store.getSnapshot().splitTabIds).toBeUndefined();
  });
  it('swaps explicit visible placement and rejects stale or two-terminal pairs', () => {
    const store = new DockStore();
    store.openLink('https://a.example');
    const a = store.getSnapshot().activeTabId;
    store.toggleSplitView();
    store.placeTab(a, 'right');
    expect(store.getSnapshot().splitTabIds).toEqual([CHAT_TAB_ID, a]);
    const before = store.getSnapshot();
    store.placeTab('missing', 'right');
    expect(store.getSnapshot()).toBe(before);
    store.openTerminal();
    const first = store.getSnapshot().activeTabId;
    store.newTerminal();
    const second = store.getSnapshot().activeTabId;
    store.placeTab(first, 'right');
    expect(store.getSnapshot().splitTabIds).not.toEqual([second, first]);
  });
  it('reopens a chosen history entry and never leaks another workspace history', () => {
    const store = new DockStore();
    store.setActiveWorkspace('a');
    store.openLink('https://first.example');
    store.close(store.getSnapshot().activeTabId);
    store.openLink('https://second.example');
    store.close(store.getSnapshot().activeTabId);
    expect(store.getClosedTabs().map(tab => tab.url)).toEqual(['https://second.example', 'https://first.example']);
    store.setActiveWorkspace('b');
    expect(store.getClosedTabs()).toEqual([]);
    store.setActiveWorkspace('a');
    store.reopenClosedTab(1);
    expect(store.getSnapshot().tabs[0]).toMatchObject({ url: 'https://first.example' });
    expect(store.getClosedTabs().map(tab => tab.url)).toEqual(['https://second.example']);
  });
});
