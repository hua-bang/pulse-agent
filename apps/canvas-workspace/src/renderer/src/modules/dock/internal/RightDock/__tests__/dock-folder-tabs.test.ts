import { describe, expect, it } from 'vitest';
import { DockStore } from '../state/dock-store';

describe('folder tabs', () => {
  it('deduplicates folders and restores selection in the owning scope', () => {
    const store = new DockStore();
    store.setActiveWorkspace('a');
    store.openFolder('/work/project');
    const id = store.getSnapshot().activeTabId;
    store.selectFolderFile(id, '/work/project/a.ts');
    store.openFolder('/work/project');
    expect(store.getSnapshot().tabs).toHaveLength(1);
    store.setActiveWorkspace('b');
    expect(store.getSnapshot().tabs).toHaveLength(0);
    store.openFolder('/work/project');
    expect(store.getSnapshot().tabs[0]).not.toHaveProperty('selectedPath');
    store.setActiveWorkspace('a');
    expect(store.getSnapshot().tabs[0]).toMatchObject({ selectedPath: '/work/project/a.ts' });
    expect(store.getSnapshot().activeTabId).toBe(id);
  });
  it('supports split view and closes without changing the workspace', () => {
    const store = new DockStore();
    store.setActiveWorkspace('a');
    store.openFolder('/work/project');
    const id = store.getSnapshot().activeTabId;
    store.toggleSplitView();
    expect(store.getSnapshot().splitTabIds).toContain(id);
    store.close(id);
    expect(store.getSnapshot().splitTabIds).toBeUndefined();
    expect(store.getSnapshot().activeTerminalWorkspaceId).toBe('a');
    expect(store.getSnapshot().activeTabId).toBe('chat');
  });
});


it('keeps one folder tab when the workspace root changes and drops the old selection', () => {
  const store = new DockStore();
  store.setActiveWorkspace('a');
  store.openFolder('/old');
  store.selectFolderFile('folder', '/old/file.ts');
  store.openFolder('/new');
  expect(store.getSnapshot().tabs.filter(tab => tab.kind === 'folder')).toEqual([
    { id: 'folder', kind: 'folder', folderPath: '/new', title: 'new' },
  ]);
  store.openFolder('/new');
  expect(store.getSnapshot().tabs).toHaveLength(1);
});
