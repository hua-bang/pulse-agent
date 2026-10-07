import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ArrowsClockwise,
  CaretRight,
  ChatCircle,
  Code,
  FilePlus,
  FolderPlus,
  Plus,
  SidebarSimple,
} from '@phosphor-icons/react';
import { FolderIcon } from '../../../../../components/icons';
import { Button, EmptyState, Popover } from '../../../../../components/ui';
import { useI18n } from '../../../../../i18n';
import { useAppShell } from '../../../../../shared/appShell';
import { matchShortcut, formatShortcutId } from '../../../../../shortcuts/registry';
import type { ShortcutIdFor } from '../../../../../shortcuts/definitions';
import type { DockPreviewTab, DockStore } from '../state/dock-store';
import { isFileDirty } from '../state/dock-folder-editor';
import { EntryNameInput } from './EntryNameInput';
import { FileContent, isImage, isMarkdown } from './FileContent';
import { FileTree, type FolderMutation } from './FileTree';
import { FileTypeIcon } from './FileTypeIcon';
import { UnsavedFileDialog } from './UnsavedFileDialog';
import { useFileChatAction } from './useFileChatAction';
import { useFileEditor } from './useFileEditor';
import { useMutationMessages } from './mutation-messages';
import './index.css';

const CodeEditor = lazy(() => import('./CodeEditor').then(m => ({ default: m.CodeEditor })));

interface Props {
  tab: Extract<DockPreviewTab, { kind: 'folder' }>;
  store: DockStore;
  active: boolean;
}

interface Preview {
  path: string;
  content?: string;
  version?: string;
  upgradeRequired?: boolean;
  imagePath?: string;
  error?: string;
  loading?: boolean;
}

type RootEditMode = 'file' | 'directory' | null;

const AUTO_REFRESH_INTERVAL_MS = 2_000;

const parentFilePath = (path: string): string => {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index > 0 ? path.slice(0, index) : path;
};

const isPathWithin = (path: string, entryPath: string): boolean => (
  path === entryPath || path.startsWith(`${entryPath}/`) || path.startsWith(`${entryPath}\\`)
);

const replacePathRoot = (path: string, previousRoot: string, nextRoot: string): string => (
  path === previousRoot ? nextRoot : `${nextRoot}${path.slice(previousRoot.length)}`
);

export const FolderDockTab = ({ tab, store, active }: Props) => {
  const { t } = useI18n();
  const message = useMutationMessages();
  const { confirm, notify } = useAppShell();
  const editing = useFileEditor(store);
  const { state: editState, editor, scope } = editing;
  const draft = editState.draft?.path === tab.selectedPath ? editState.draft : undefined;
  const { addToChat, adding, available } = useFileChatAction(store, tab.id);
  const [treeVisible, setTreeVisible] = useState(true);
  const [source, setSource] = useState(false);
  const [revision, setRevision] = useState(0);
  const [mutation, setMutation] = useState<FolderMutation>();
  const [rootEditMode, setRootEditMode] = useState<RootEditMode>(null);
  const [rootCreateMenuOpen, setRootCreateMenuOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const mutationId = useRef(0);
  const rootCreateButtonRef = useRef<HTMLButtonElement>(null);
  const addDirectory = (directory: string) => editing.guard(() => { void addToChat(directory, true); });
  const path = tab.selectedPath;
  const pathRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = pathRef.current;
    if (!element) return;
    const revealFile = () => { element.scrollLeft = element.scrollWidth; };
    const observer = new ResizeObserver(revealFile);
    observer.observe(element);
    revealFile();
    return () => observer.disconnect();
  }, [path]);

  useEffect(() => {
    if (!active) return;
    const refresh = () => setRevision(value => value + 1);
    refresh();
    const interval = window.setInterval(refresh, AUTO_REFRESH_INTERVAL_MS);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, [active]);

  const segments = path?.slice(tab.folderPath.replace(/[\\/]$/, '').length + 1).split(/[\\/]/) ?? [];

  useEffect(() => {
    if (!active || !path) return;
    const existing = editor.get(scope);
    if (isFileDirty(existing) || existing.saving) return;
    let current = true;
    setPreview({ path, loading: true });
    const load = async (): Promise<Preview> => {
      if (isImage(path)) {
        const result = await window.canvasWorkspace.file.getImagePreview(path, 1600);
        return result.ok && result.preview
          ? { path, imagePath: result.preview.path }
          : { path, error: result.error || t('folder.readFailed') };
      }
      const result = await window.canvasWorkspace.file.preview(path);
      if (!result.ok) return { path, error: result.error };
      if (result.kind === 'text') return {
        path,
        content: result.content,
        version: result.version,
        upgradeRequired: !result.version || typeof window.canvasWorkspace.file.savePreview !== 'function',
      };
      return { path, error: t(result.kind === 'too-large' ? 'folder.tooLarge' : 'folder.unsupported') };
    };
    void load().then(result => {
      if (!current) return;
      const latest = editor.get(scope);
      if (isFileDirty(latest) || latest.saving) return;
      setPreview(result);
      if (result.content !== undefined && result.version && !result.upgradeRequired) editor.update(scope, {
        draft: { path, content: result.content, original: result.content, version: result.version },
        error: undefined,
      });
      else if (latest.draft?.path === path) editor.discard(scope);
    }).catch(error => { if (current) setPreview({ path, error: String(error) }); });
    return () => { current = false; };
  }, [active, path, revision, t, editor, scope, Boolean(draft)]);

  const refreshParent = (parentPath: string) => {
    mutationId.current += 1;
    setMutation({ id: mutationId.current, parentPath });
  };

  const mutationUnavailable = (): string => message('mutationUnavailable');

  const createEntry = async (parentPath: string, kind: 'file' | 'directory', name: string): Promise<string | undefined> => {
    const operation = window.canvasWorkspace.file.createEntry;
    if (typeof operation !== 'function') return mutationUnavailable();
    try {
      const result = await operation({ rootPath: tab.folderPath, parentPath, name, kind });
      if (!result.ok) return result.error;
      refreshParent(parentPath);
      if (kind === 'file') {
        setSource(false);
        store.selectFolderFile(tab.id, result.path);
      }
      return undefined;
    } catch (error) {
      return String(error);
    }
  };

  const renameEntry = async (entryPath: string, name: string): Promise<string | undefined> => {
    const operation = window.canvasWorkspace.file.renameEntry;
    if (typeof operation !== 'function') return mutationUnavailable();
    try {
      const result = await operation({ rootPath: tab.folderPath, entryPath, newName: name });
      if (!result.ok) return result.error;
      if (path && isPathWithin(path, entryPath)) {
        editor.discard(scope);
        setSource(false);
        store.selectFolderFile(tab.id, replacePathRoot(path, entryPath, result.path));
      }
      refreshParent(parentFilePath(entryPath));
      return undefined;
    } catch (error) {
      return String(error);
    }
  };

  const trashEntry = async (entryPath: string, name: string) => {
    const accepted = await confirm({
      title: message('trashTitle', { name }),
      description: message('trashDescription'),
      confirmLabel: message('trashConfirm'),
      intent: 'danger',
    });
    if (!accepted) return;
    const operation = window.canvasWorkspace.file.trashEntry;
    if (typeof operation !== 'function') {
      notify({ tone: 'error', title: message('operationFailed'), description: mutationUnavailable() });
      return;
    }
    try {
      const result = await operation({ rootPath: tab.folderPath, entryPath });
      if (!result.ok) throw new Error(result.error);
      if (path && isPathWithin(path, entryPath)) {
        editor.discard(scope);
        setSource(false);
        store.selectFolderFile(tab.id);
      }
      refreshParent(parentFilePath(entryPath));
    } catch (error) {
      notify({ tone: 'error', title: message('operationFailed'), description: String(error) });
    }
  };

  const openInVSCode = async (filePath: string) => {
    try {
      const result = await window.canvasWorkspace.file.openInVSCode(filePath);
      if (!result.ok) throw new Error(result.error || t('folder.openFailed'));
    } catch (error) {
      notify({ tone: 'error', title: t('folder.openFailed'), description: String(error) });
    }
  };

  const current: Preview | null = draft
    ? { path: draft.path, content: draft.content, version: draft.version }
    : preview?.path === path ? preview : null;

  return (
    <section className="folder-browser" onKeyDownCapture={event => {
      if (!draft || event.nativeEvent.isComposing) return;
      const handlers: Record<ShortcutIdFor<'file-editor'>, () => void> = {
        'fileEditor.save': () => { void editing.save(); },
      };
      const match = matchShortcut(event, 'file-editor');
      if (match) {
        event.preventDefault();
        event.stopPropagation();
        handlers[match.id as ShortcutIdFor<'file-editor'>]();
      }
    }}>
      <header className="folder-browser__toolbar">
        <nav ref={pathRef} className="folder-browser__path" aria-label={t('folder.path')} title={path || tab.folderPath}>
          <Button size="xs" className="folder-browser__root" onClick={() => store.selectFolderFile(tab.id)}>{tab.title}</Button>
          {segments.map((segment, index) => <span className="folder-browser__segment" key={index}>
            <CaretRight size={12} />
            {index === segments.length - 1 && <FileTypeIcon name={segment} />}
            <span className={index === segments.length - 1 ? 'folder-browser__current-file' : undefined}>{segment}</span>
          </span>)}
        </nav>
        {draft && (editing.dirty || editState.saving) && <Button variant="icon" size="xs" className="folder-browser__save-dot"
          disabled={editState.saving} aria-label={t('folder.save')} title={`${t('folder.unsaved')} · ${formatShortcutId('fileEditor.save')}`}
          onClick={() => { void editing.save(); }}><span aria-hidden="true">●</span></Button>}
        {path && <Button variant="icon" size="sm" aria-label={t('folder.addToChat')} title={t('folder.addToChat')}
          disabled={!available || adding} onClick={() => editing.guard(() => { setTreeVisible(false); void addToChat(path); })}>
          <ChatCircle size={16} />
        </Button>}
        <Button size="xs" title={t('folder.openFileVSCode')} onClick={() => editing.guard(() => { void openInVSCode(path || tab.folderPath); })}>
          <Code size={14} />{t('folder.vscode')}
        </Button>
        <Button variant="icon" size="sm" aria-label={t('folder.toggleTree')} title={t('folder.toggleTree')}
          aria-pressed={treeVisible} onClick={() => setTreeVisible(value => !value)}><SidebarSimple size={16} /></Button>
      </header>
      {current?.upgradeRequired && <div className="folder-browser__hint" role="status">{t('folder.restartRequired')}</div>}
      {draft && editState.error && <div className="folder-browser__hint" role="alert">{editState.error}</div>}
      <div className="folder-browser__body">
        <section className="folder-browser__preview">
          {path && isMarkdown(path) && <div className="folder-browser__mode">
            <Button size="xs" aria-pressed={source} onClick={() => setSource(value => !value)}>
              {t(source ? 'folder.showPreview' : 'folder.showSource')}
            </Button>
          </div>}
          {draft && (!isMarkdown(draft.path) || source) ? <Suspense fallback={<div className="folder-browser__hint">{t('folder.loading')}</div>}>
            <CodeEditor key={`${scope}:${draft.path}`} path={draft.path} content={draft.content} original={draft.original}
              saving={Boolean(editState.saving)} onChange={content => editor.edit(scope, content)} />
          </Suspense> : !path ? <EmptyState icon={<FolderIcon size={28} />} title={t('folder.chooseFile')} description={t('folder.chooseHint')} />
            : !current || current.loading ? <div className="folder-browser__hint">{t('folder.loading')}</div>
            : current.error ? <div className="folder-browser__hint" role="alert">{current.error}</div>
            : <FileContent key={path} path={path} content={draft?.content ?? current.content ?? ''} source={source} imagePath={current.imagePath} />}
        </section>
        {treeVisible && <aside className="folder-browser__tree" aria-label={t('folder.files')}>
          <div className="folder-browser__tree-header folder-browser__directory-row">
            <span>{tab.title}</span>
            <div className="folder-browser__root-actions">
              {available && <Button variant="icon" size="xs" className="folder-browser__directory-chat" disabled={adding}
                title={t('folder.addDirectory', { name: tab.title })} aria-label={t('folder.addDirectory', { name: tab.title })}
                onClick={() => addDirectory(tab.folderPath)}><ChatCircle size={14} /></Button>}
              <Button ref={rootCreateButtonRef} variant="icon" size="xs" aria-label={message('createIn', { name: tab.title })}
                title={message('createIn', { name: tab.title })} aria-haspopup="menu" aria-expanded={rootCreateMenuOpen}
                onClick={() => setRootCreateMenuOpen(value => !value)}><Plus size={15} /></Button>
              {rootCreateMenuOpen && <Popover anchorRef={rootCreateButtonRef} placement="bottom" align="end" gap={4}
                ariaLabel={message('createIn', { name: tab.title })} className="folder-browser__action-menu context-menu--in-dock"
                onClose={() => setRootCreateMenuOpen(false)}>
                <Button size="sm" className="folder-browser__action-menu-item" role="menuitem" onClick={() => {
                  setRootCreateMenuOpen(false);
                  editing.guard(() => setRootEditMode('file'));
                }}><FilePlus size={15} /><span>{message('newFile')}</span></Button>
                <Button size="sm" className="folder-browser__action-menu-item" role="menuitem" onClick={() => {
                  setRootCreateMenuOpen(false);
                  editing.guard(() => setRootEditMode('directory'));
                }}><FolderPlus size={15} /><span>{message('newFolder')}</span></Button>
              </Popover>}
              <Button variant="icon" size="xs" aria-label={t('folder.refresh')} title={t('folder.refresh')}
                onClick={() => editing.guard(() => { editor.discard(scope); setRevision(value => value + 1); })}>
                <ArrowsClockwise size={14} />
              </Button>
            </div>
          </div>
          {rootEditMode && <EntryNameInput
            ariaLabel={message(rootEditMode === 'file' ? 'newFileName' : 'newFolderName')}
            onCancel={() => setRootEditMode(null)}
            onSubmit={async name => {
              const error = await createEntry(tab.folderPath, rootEditMode, name);
              if (!error) setRootEditMode(null);
              return error;
            }}
          />}
          <FileTree key={tab.folderPath} path={tab.folderPath} selectedPath={path}
            revision={revision} mutation={mutation} onAddDirectory={available ? addDirectory : undefined} adding={adding}
            onCreate={createEntry} onRename={renameEntry} onTrash={(entryPath, name) => { void trashEntry(entryPath, name); }}
            requestAction={editing.guard}
            onSelect={selected => editing.guard(() => { setSource(false); store.selectFolderFile(tab.id, selected); })}
          />
        </aside>}
      </div>
      <UnsavedFileDialog controller={editing} />
    </section>
  );
};
