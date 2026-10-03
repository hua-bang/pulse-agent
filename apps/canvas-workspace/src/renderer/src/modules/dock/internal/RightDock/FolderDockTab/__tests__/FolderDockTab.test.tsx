// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { history, undoDepth } from '@codemirror/commands';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../../i18n';
import { FolderDockTab } from '..';
import { syncEditorContent } from '../CodeEditor';
import { DockStore } from '../../dock-store';
import type { FilePreviewResult } from '../../../../../../types';

const { confirm, deliver, notify, activeTarget, listeners } = vi.hoisted(() => ({ confirm: vi.fn(), deliver: vi.fn(), notify: vi.fn(), activeTarget: vi.fn(), listeners: new Set<() => void>() }));
vi.mock('../../../../../chat', () => ({ useOptionalChatTargetBroker: () => ({ deliver, getActiveTarget: activeTarget, subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); } }) }));
vi.mock('../../../../../chat/delivery', () => ({ useChatDeliveryNotifier: () => notify }));
vi.mock('../../../../../../shared/appShell', () => ({ useAppShell: () => ({ confirm, notify }) }));
vi.mock('../CodeEditor', async importOriginal => ({
  ...await importOriginal<typeof import('../CodeEditor')>(),
  CodeEditor: ({ content }: { content: string }) => <textarea aria-label="Code editor" value={content} readOnly />,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
let store: DockStore;
const preview = vi.fn();
const savePreview = vi.fn();
const listDir = vi.fn();
const createEntry = vi.fn();
const renameEntry = vi.fn();
const trashEntry = vi.fn();
const openInVSCode = vi.fn();
const getImagePreview = vi.fn();
const originalApi = window.canvasWorkspace;
const folderDockCss = readFileSync('src/renderer/src/modules/dock/internal/RightDock/FolderDockTab/index.css', 'utf8');

beforeEach(() => {
  vi.clearAllMocks();
  listeners.clear();
  activeTarget.mockReturnValue({ scopeId: 'workspace' });
  savePreview.mockResolvedValue({ ok: true, version: 'v2' });
  confirm.mockResolvedValue(true);
  createEntry.mockImplementation(async ({ parentPath, name }: { parentPath: string; name: string }) => ({ ok: true, path: `${parentPath}/${name}` }));
  renameEntry.mockImplementation(async ({ entryPath, newName }: { entryPath: string; newName: string }) => ({ ok: true, path: `${entryPath.slice(0, entryPath.lastIndexOf('/'))}/${newName}` }));
  trashEntry.mockImplementation(async ({ entryPath }: { entryPath: string }) => ({ ok: true, path: entryPath }));
  listDir.mockResolvedValue({ ok: true, entries: [{ name: 'a.ts', type: 'file' }, { name: 'b.md', type: 'file' }] });
  preview.mockResolvedValue({ ok: true, kind: 'text', version: 'v1', content: 'const value = 1;\n' });
  openInVSCode.mockResolvedValue({ ok: true });
  deliver.mockResolvedValue({ status: 'delivered', target: { surface: 'dock' } });
  Object.defineProperty(window, 'canvasWorkspace', { configurable: true, value: { file: { preview, savePreview, listDir, createEntry, renameEntry, trashEntry, openInVSCode, getImagePreview } } });
  store = new DockStore();
  store.setActiveWorkspace('workspace');
  store.openFolder('/work');
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); Object.defineProperty(window, 'canvasWorkspace', { configurable: true, value: originalApi }); });
const render = async (path: string | null = '/work/a.ts') => {
  act(() => store.selectFolderFile('folder', path ?? undefined));
  const tab = store.getSnapshot().tabs[0];
  if (tab.kind !== 'folder') throw new Error('Expected folder tab');
  await act(async () => root.render(<I18nProvider><FolderDockTab tab={tab} store={store} active /></I18nProvider>));
};
const click = async (label: string) => {
  const button = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.getAttribute('aria-label') === label || b.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
};
const typeIn = async (input: HTMLInputElement, value: string) => {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('folder preview interactions', () => {
  it('renders highlighted source with line numbers and opens the exact file or directory in VS Code', async () => {
    await render();
    expect(host.querySelector('textarea')?.value).toBe('const value = 1;\n');
    expect(host.querySelector('.folder-browser__edit-bar')).toBeNull();
    expect(host.querySelector('[aria-label=Save]')).toBeNull();
    expect(listDir).toHaveBeenCalledWith('/work', 0, true);
    await click('VS Code');
    expect(openInVSCode).toHaveBeenCalledWith('/work/a.ts');
    expect(host.querySelector('.folder-browser__open-folder')).toBeNull();
  });
  it('inserts a file reference and reveals chat beside the file', async () => {
    await render(); await click('Add to conversation');
    expect(deliver).toHaveBeenCalledWith({ kind: 'file', filePath: '/work/a.ts' });
    expect(store.getSnapshot().splitTabIds).toEqual(['folder', 'chat']);
  });
  it('ignores stale file reads and supports Markdown source switching', async () => {
    let finish: (value: FilePreviewResult) => void = () => undefined;
    preview.mockReturnValueOnce(new Promise<FilePreviewResult>(resolve => { finish = resolve; }));
    await render();
    preview.mockResolvedValue({ ok: true, kind: 'text', version: 'v1', content: '# New document' });
    await render('/work/b.md');
    await act(async () => finish({ ok: true, kind: 'text', version: 'v1', content: 'OLD FILE' }));
    expect(host.querySelector('h1')?.textContent).toBe('New document');
    expect(host.textContent).not.toContain('OLD FILE');
    await click('Source');
    expect(host.querySelector('textarea')?.value).toBe('# New document');
  });
  it('shows read failures and keeps the external editor action available', async () => {
    preview.mockResolvedValue({ ok: false, error: 'Permission denied' });
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Permission denied');
    await click('VS Code');
    expect(openInVSCode).toHaveBeenCalledWith('/work/a.ts');
  });
  it('previews images through the existing image service', async () => {
    getImagePreview.mockResolvedValue({ ok: true, preview: { path: '/preview/image.png' } });
    await render('/work/image.png');
    expect(getImagePreview).toHaveBeenCalledWith('/work/image.png', 1600);
    expect(host.querySelector('img')?.getAttribute('src')).toContain('image.png');
    expect(preview).not.toHaveBeenCalled();
  });
});


it('waits for first chat mount before delivering the exact file', async () => {
  activeTarget.mockReturnValue(null);
  await render(); await click('Add to conversation');
  expect(deliver).not.toHaveBeenCalled();
  expect(store.getSnapshot().splitTabIds).toContain('chat');
  activeTarget.mockReturnValue({ scopeId: 'workspace' });
  await act(async () => { for (const listener of [...listeners]) listener(); });
  expect(deliver).toHaveBeenCalledWith({ kind: 'file', filePath: '/work/a.ts' });
  expect(listeners.size).toBe(0);
});

it('does not deliver a pending file to a different workspace', async () => {
  activeTarget.mockReturnValue(null);
  await render(); await click('Add to conversation');
  store.setActiveWorkspace('other');
  activeTarget.mockReturnValue({ scopeId: 'workspace' });
  await act(async () => { for (const listener of [...listeners]) listener(); });
  expect(deliver).not.toHaveBeenCalled();
});


it('uses the root breadcrumb to return to the folder and open it in VS Code', async () => {
  await render();
  await click('work');
  expect(store.getSnapshot().tabs[0]).toMatchObject({ selectedPath: undefined });
  await render(null);
  await click('VS Code');
  expect(openInVSCode).toHaveBeenCalledWith('/work');
  expect(host.querySelector('.folder-browser__open-folder')).toBeNull();
});


it('saves the exact edited content through the version checked API with Command-S', async () => {
  await render();
  act(() => store.folderEditor.edit('workspace', 'const changed = 2;'));
  const textarea = host.querySelector('textarea');
  expect(textarea?.value).toBe('const changed = 2;');
  await act(async () => textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true })));
  expect(savePreview).toHaveBeenCalledWith({ filePath: '/work/a.ts', content: 'const changed = 2;', expectedVersion: 'v1' });
  expect(store.folderEditor.get('workspace').draft).toMatchObject({ original: 'const changed = 2;', version: 'v2' });
});

it('keeps the draft on conflict and lets Cancel or Discard resolve a blocked close', async () => {
  await render();
  act(() => store.folderEditor.edit('workspace', 'draft'));
  savePreview.mockResolvedValue({ ok: false, conflict: true, error: 'changed externally' });
  await click('Save');
  expect(host.querySelector('[role=alert]')?.textContent).toContain('changed outside');
  expect(store.folderEditor.get('workspace').draft?.content).toBe('draft');
  act(() => store.close('folder'));
  expect(document.querySelector('[role=dialog]')).not.toBeNull();
  const dialogClick = async (label: string) => {
    const button = [...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')].find(b => b.textContent === label);
    await act(async () => button?.click());
  };
  await dialogClick('Cancel');
  expect(store.getSnapshot().tabs).toHaveLength(1);
  act(() => store.close('folder'));
  await dialogClick('Discard');
  expect(store.getSnapshot().tabs).toHaveLength(0);
});


it('explains the required restart when an old main process cannot support safe editing', async () => {
  preview.mockResolvedValue({ ok: true, kind: 'text', content: 'const legacy = true;' });
  await render();
  expect(host.querySelector('[role=status]')?.textContent).toContain('Restart Pulse Canvas');
  expect(host.querySelector('.folder-browser__code')?.textContent).toContain('const legacy = true;');
  expect(host.querySelector('textarea')).toBeNull();
  expect(store.folderEditor.get('workspace').draft).toBeUndefined();
});


it('adds a collapsed directory without toggling it, preserving the absolute directory identity', async () => {
  listDir.mockResolvedValue({ ok: true, entries: [{ name: 'source', type: 'dir' }] });
  await render();
  await click('More actions for source');
  await click('Add source folder to conversation');
  expect(deliver).toHaveBeenCalledWith({ kind: 'file', filePath: '/work/source', isDirectory: true });
  expect(host.querySelector('.folder-browser__children')).toBeNull();
  expect(store.getSnapshot().splitTabIds).toContain('chat');
});

it('also offers the opened root directory as a conversation reference', async () => {
  await render();
  await click('Add work folder to conversation');
  expect(deliver).toHaveBeenCalledWith({ kind: 'file', filePath: '/work', isDirectory: true });
});

it('keeps narrow tree rows to at most two fixed action buttons and moves commands into a dock-layer menu', async () => {
  listDir.mockResolvedValue({ ok: true, entries: [{ name: 'source', type: 'dir' }, { name: 'a.ts', type: 'file' }] });
  await render();
  const actionGroups = [...host.querySelectorAll<HTMLElement>('.folder-browser__entry-actions')];
  expect(actionGroups).toHaveLength(2);
  expect(actionGroups[0].querySelectorAll(':scope > button')).toHaveLength(2);
  expect(actionGroups[1].querySelectorAll(':scope > button')).toHaveLength(1);
  expect(host.querySelector('[aria-label="Rename source"]')).toBeNull();
  expect(host.querySelector('[aria-label="Move source to Trash"]')).toBeNull();
  await click('More actions for source');
  expect(document.querySelector('[role="menu"] [role="menuitem"]')).not.toBeNull();
  expect(document.querySelector('.folder-browser__action-menu.context-menu--in-dock')?.textContent).toContain('Rename source');
  expect(document.querySelector('.folder-browser__action-menu')?.textContent).toContain('Move source to Trash');
  expect(folderDockCss).toMatch(/\.folder-browser__action-menu\s*\{[^}]*z-index:\s*var\(--layer-dock-menu\);/s);
});

it('syncs externally refreshed content into CodeMirror without adding an undo step', () => {
  const editor = new EditorView({ state: EditorState.create({ doc: 'before', extensions: [history()] }) });
  expect(syncEditorContent(editor, 'after')).toBe(true);
  expect(editor.state.doc.toString()).toBe('after');
  expect(undoDepth(editor.state)).toBe(0);
  expect(syncEditorContent(editor, 'after')).toBe(false);
  editor.destroy();
});

it('refreshes the file tree and a clean selected file while the Folder tab is active', async () => {
  let refresh: TimerHandler | undefined;
  vi.spyOn(window, 'setInterval').mockImplementation(((handler: TimerHandler) => {
    refresh = handler;
    return 1;
  }) as typeof window.setInterval);
  await render();
  listDir.mockClear();
  preview.mockClear();
  listDir.mockResolvedValue({ ok: true, entries: [{ name: 'a.ts', type: 'file' }, { name: 'external.ts', type: 'file' }] });
  preview.mockResolvedValue({ ok: true, kind: 'text', version: 'v2', content: 'const value = 2;\n' });

  await act(async () => {
    if (typeof refresh === 'function') refresh();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(listDir).toHaveBeenCalledWith('/work', 0, true);
  expect(preview).toHaveBeenCalledWith('/work/a.ts');
  expect(host.querySelector('.folder-browser__tree')?.textContent).toContain('external.ts');
  expect(host.querySelector('textarea')?.value).toBe('const value = 2;\n');
});

it('creates files and folders from the opened root with an inline name field', async () => {
  await render(null);
  await click('Create in work');
  await click('New file');
  const fileName = host.querySelector<HTMLInputElement>('[aria-label="New file name"]');
  expect(fileName).not.toBeNull();
  await typeIn(fileName!, 'draft.md');
  await act(async () => {
    fileName!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(createEntry).toHaveBeenCalledWith({ rootPath: '/work', parentPath: '/work', name: 'draft.md', kind: 'file' });
  expect(store.getSnapshot().tabs[0]).toMatchObject({ selectedPath: '/work/draft.md' });

  await render(null);
  await click('Create in work');
  await click('New folder');
  const folderName = host.querySelector<HTMLInputElement>('[aria-label="New folder name"]');
  await typeIn(folderName!, 'notes');
  await act(async () => {
    folderName!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  expect(createEntry).toHaveBeenCalledWith({ rootPath: '/work', parentPath: '/work', name: 'notes', kind: 'directory' });
});

it('renames the selected file and keeps the preview on its new path', async () => {
  await render();
  await click('More actions for a.ts');
  await click('Rename a.ts');
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Rename a.ts"]');
  expect(input).not.toBeNull();
  await typeIn(input!, 'renamed.ts');
  await click('Confirm name');
  expect(renameEntry).toHaveBeenCalledWith({ rootPath: '/work', entryPath: '/work/a.ts', newName: 'renamed.ts' });
  expect(store.getSnapshot().tabs[0]).toMatchObject({ selectedPath: '/work/renamed.ts' });
});

it('remaps a selected descendant after renaming its parent folder', async () => {
  listDir.mockResolvedValue({ ok: true, entries: [{ name: 'source', type: 'dir' }] });
  await render('/work/source/inside.ts');
  await click('More actions for source');
  await click('Rename source');
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Rename source"]');
  expect(input).not.toBeNull();
  await typeIn(input!, 'renamed-source');
  await click('Confirm name');
  expect(renameEntry).toHaveBeenCalledWith({ rootPath: '/work', entryPath: '/work/source', newName: 'renamed-source' });
  expect(store.getSnapshot().tabs[0]).toMatchObject({ selectedPath: '/work/renamed-source/inside.ts' });
});

it('confirms trashing an entry and clears a preview that was inside it', async () => {
  listDir.mockResolvedValue({ ok: true, entries: [{ name: 'source', type: 'dir' }] });
  await render('/work/source/inside.ts');
  await click('More actions for source');
  await click('Move source to Trash');
  expect(confirm).toHaveBeenCalled();
  expect(trashEntry).toHaveBeenCalledWith({ rootPath: '/work', entryPath: '/work/source' });
  expect(store.getSnapshot().tabs[0]).toMatchObject({ selectedPath: undefined });
});

it('blocks file mutations behind the existing unsaved-draft guard', async () => {
  await render();
  act(() => store.folderEditor.edit('workspace', 'unsaved draft'));
  await click('Create in work');
  await click('New file');
  expect(host.querySelector('input[aria-label="New file name"]')).toBeNull();
  expect(document.querySelector('[role=dialog]')).not.toBeNull();
  const discard = [...document.querySelectorAll<HTMLButtonElement>('[role=dialog] button')]
    .find(button => button.textContent === 'Discard');
  await act(async () => discard?.click());
  expect(host.querySelector('input[aria-label="New file name"]')).not.toBeNull();
});

it('animates folder disclosure, keeps exiting children inert, and cancels stale collapse cleanup', async () => {
  listDir.mockImplementation(async (path: string) => ({ ok: true, entries: path === '/work'
    ? [{ name: 'source', type: 'dir' }]
    : [{ name: 'inside.ts', type: 'file' }] }));
  await render(null);
  expect(listDir).not.toHaveBeenCalledWith('/work/source', 0, true);
  await click('source');
  const collapse = host.querySelector<HTMLElement>('.folder-browser__collapse')!;
  expect(collapse.dataset.expanded).toBe('true');
  expect(collapse.hasAttribute('inert')).toBe(false);
  expect(collapse.textContent).toContain('inside.ts');
  await click('source');
  expect(collapse.dataset.expanded).toBe('false');
  expect(collapse.hasAttribute('inert')).toBe(true);
  expect(collapse.getAttribute('aria-hidden')).toBe('true');
  expect(collapse.textContent).toContain('inside.ts');
  await click('source');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 240)); });
  expect(collapse.textContent).toContain('inside.ts');
  await click('source');
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 240)); });
  expect(collapse.querySelector('.folder-browser__children')).toBeNull();
});
