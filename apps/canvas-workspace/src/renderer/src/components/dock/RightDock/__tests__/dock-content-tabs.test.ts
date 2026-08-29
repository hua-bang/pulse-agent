import { describe, expect, it, vi } from 'vitest';
import { DockStore } from '../dock-store';
import {
  canPreviewWorkspaceCanvas,
  hasDockContentTabs,
  isDockContentTabVisible,
  toggleFullPageDockContentTabs,
} from '../dock-content-tabs';

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

describe('canPreviewWorkspaceCanvas', () => {
  it('allows previewing a workspace canvas that is not live in the Workbench', () => {
    const store = new DockStore();
    expect(canPreviewWorkspaceCanvas(store.getSnapshot(), 'ws-1')).toBe(true);
  });

  it('refuses when the same canvas is already mounted live', () => {
    const store = new DockStore();
    store.setMountedWorkspaces(['ws-1']);
    expect(canPreviewWorkspaceCanvas(store.getSnapshot(), 'ws-1')).toBe(false);
    // A different workspace is unaffected.
    expect(canPreviewWorkspaceCanvas(store.getSnapshot(), 'ws-2')).toBe(true);
  });

  it('refuses when there is no workspace to preview (global/scheduled chat)', () => {
    const store = new DockStore();
    expect(canPreviewWorkspaceCanvas(store.getSnapshot(), undefined)).toBe(false);
  });
});

describe('toggleFullPageDockContentTabs', () => {
  const actions = () => ({
    collapse: vi.fn(),
    openContentStarter: vi.fn(),
    toggleContentTabs: vi.fn(),
  });

  it('toggles existing content tabs', () => {
    const store = seeded();
    const dockActions = actions();
    toggleFullPageDockContentTabs(store.getSnapshot(), undefined, dockActions);
    expect(dockActions.toggleContentTabs).toHaveBeenCalledOnce();
    expect(dockActions.openContentStarter).not.toHaveBeenCalled();
  });

  it('opens the starter instead of creating an implicit tab when there is no content', () => {
    const store = new DockStore();
    const dockActions = actions();
    toggleFullPageDockContentTabs(
      store.getSnapshot(),
      { id: 'ws-1', title: 'Workspace one' },
      dockActions,
    );
    expect(dockActions.openContentStarter).toHaveBeenCalledOnce();
    expect(dockActions.collapse).not.toHaveBeenCalled();
    expect(dockActions.toggleContentTabs).not.toHaveBeenCalled();
  });

  it('collapses the starter when no content exists and the dock is already expanded', () => {
    const store = new DockStore();
    store.openContentStarter();
    const dockActions = actions();
    toggleFullPageDockContentTabs(store.getSnapshot(), undefined, dockActions);
    expect(dockActions.collapse).toHaveBeenCalledOnce();
    expect(dockActions.openContentStarter).not.toHaveBeenCalled();
  });
});
