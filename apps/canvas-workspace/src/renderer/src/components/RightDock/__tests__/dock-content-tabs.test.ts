import { describe, expect, it } from 'vitest';
import { DockStore } from '../dock-store';
import { hasDockContentTabs, isDockContentTabVisible } from '../dock-content-tabs';

const seeded = (): DockStore => {
  const store = new DockStore();
  store.setActiveWorkspace('ws-1');
  store.openLink('https://example.com/');
  return store;
};

describe('dock content tabs', () => {
  it('does nothing when there is no content tab to show', () => {
    const store = new DockStore();
    store.toggleContentTabs();
    expect(store.getSnapshot().expanded).toBe(false);
    expect(hasDockContentTabs(store.getSnapshot())).toBe(false);
  });

  it('collapses and re-shows the same content tab', () => {
    const store = seeded();
    const tabId = store.getSnapshot().tabs[0].id;
    expect(isDockContentTabVisible(store.getSnapshot())).toBe(true);

    store.toggleContentTabs();
    expect(store.getSnapshot().expanded).toBe(false);
    expect(isDockContentTabVisible(store.getSnapshot())).toBe(false);

    store.toggleContentTabs();
    expect(store.getSnapshot().expanded).toBe(true);
    expect(store.getSnapshot().activeTabId).toBe(tabId);
  });

  it('points an expanded dock at a content tab instead of collapsing it', () => {
    // Entering a full-page chat can leave the pointer on the hidden chat tab;
    // the first click must reveal a content tab, not read as a no-op.
    const store = seeded();
    const tabId = store.getSnapshot().tabs[0].id;
    store.openChat();
    expect(store.getSnapshot().expanded).toBe(true);
    expect(isDockContentTabVisible(store.getSnapshot())).toBe(false);

    store.toggleContentTabs();
    expect(store.getSnapshot().activeTabId).toBe(tabId);
    expect(isDockContentTabVisible(store.getSnapshot())).toBe(true);
  });
});
