import { describe, expect, it } from 'vitest';
import { DockStore } from '../state/dock-store';
import { isFileDirty } from '../state/dock-folder-editor';
const setup = () => {
  const store = new DockStore();
  store.setActiveWorkspace('a'); store.openFolder('/project'); store.selectFolderFile('folder', '/project/a.ts');
  store.folderEditor.update('a', { draft: { path: '/project/a.ts', original: 'original', content: 'draft', version: 'v1' } });
  return store;
};
describe('unsaved folder editor transitions', () => {
  it('blocks file switches and tab closes until discard is confirmed', () => {
    const store = setup();
    store.selectFolderFile('folder', '/project/b.ts');
    expect(store.getSnapshot().tabs[0]).toMatchObject({ selectedPath: '/project/a.ts' });
    expect(store.folderEditor.get('a').pending).toBeTypeOf('function');
    store.folderEditor.update('a', { pending: undefined }); // Cancel.
    store.close('folder');
    expect(store.getSnapshot().tabs).toHaveLength(1);
    store.folderEditor.discard('a'); store.folderEditor.proceed('a');
    expect(store.getSnapshot().tabs).toHaveLength(0);
  });
  it('keeps drafts through workspace changes without mutating disk or other scopes', () => {
    const store = setup();
    store.setActiveWorkspace('b'); store.openFolder('/other');
    expect(store.folderEditor.get('b').draft).toBeUndefined();
    store.setActiveWorkspace('a');
    expect(store.folderEditor.get('a').draft?.content).toBe('draft');
    expect(isFileDirty(store.folderEditor.get('a'))).toBe(true);
  });
  it('does not replace a dirty root or discard draft when reselecting the same file', () => {
    const store = setup();
    store.selectFolderFile('folder', '/project/a.ts');
    expect(store.folderEditor.get('a').pending).toBeUndefined();
    store.openFolder('/replacement');
    expect(store.getSnapshot().tabs[0]).toMatchObject({ folderPath: '/project' });
    store.folderEditor.discard('a'); store.folderEditor.proceed('a');
    expect(store.getSnapshot().tabs[0]).toMatchObject({ folderPath: '/replacement' });
  });
  it('continues after a successful save, but never in another active scope', () => {
    const store = setup();
    store.close('folder');
    const draft = store.folderEditor.get('a').draft!;
    store.folderEditor.update('a', { draft: { ...draft, original: draft.content, version: 'v2' } });
    store.setActiveWorkspace('b'); store.openFolder('/other');
    store.folderEditor.proceed('a');
    expect(store.getSnapshot().tabs).toHaveLength(1);
    expect(store.getSnapshot().tabs[0]).toMatchObject({ folderPath: '/other' });
  });
});
