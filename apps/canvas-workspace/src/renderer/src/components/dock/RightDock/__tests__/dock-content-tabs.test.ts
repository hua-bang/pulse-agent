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
    openCanvasPreview: vi.fn(() => true),
    newLink: vi.fn(),
    toggleContentTabs: vi.fn(),
  });

  it('toggles existing content tabs', () => {
    const store = seeded();
    const dockActions = actions();
    toggleFullPageDockContentTabs(store.getSnapshot(), undefined, dockActions);
    expect(dockActions.toggleContentTabs).toHaveBeenCalledOnce();
    expect(dockActions.newLink).not.toHaveBeenCalled();
  });

  it('opens the scoped workspace canvas when it can be previewed', () => {
    const store = new DockStore();
    const dockActions = actions();
    toggleFullPageDockContentTabs(
      store.getSnapshot(),
      { id: 'ws-1', title: 'Workspace one' },
      dockActions,
    );
    expect(dockActions.openCanvasPreview).toHaveBeenCalledWith('ws-1', 'Workspace one');
    expect(dockActions.newLink).not.toHaveBeenCalled();
  });

  it('creates a blank tab for global chat or an already-mounted canvas', () => {
    const store = new DockStore();
    store.setMountedWorkspaces(['ws-1']);
    const globalActions = actions();
    const mountedActions = actions();
    toggleFullPageDockContentTabs(store.getSnapshot(), undefined, globalActions);
    toggleFullPageDockContentTabs(
      store.getSnapshot(),
      { id: 'ws-1', title: 'Workspace one' },
      mountedActions,
    );
    expect(globalActions.newLink).toHaveBeenCalledOnce();
    expect(mountedActions.newLink).toHaveBeenCalledOnce();
    expect(mountedActions.openCanvasPreview).not.toHaveBeenCalled();
  });

  it('creates a blank tab if the canvas preview is refused at invocation time', () => {
    const store = new DockStore();
    const dockActions = actions();
    dockActions.openCanvasPreview.mockReturnValue(false);
    toggleFullPageDockContentTabs(
      store.getSnapshot(),
      { id: 'ws-1', title: 'Workspace one' },
      dockActions,
    );
    expect(dockActions.openCanvasPreview).toHaveBeenCalledOnce();
    expect(dockActions.newLink).toHaveBeenCalledOnce();
  });
});
