import { useEffect, useRef, useState } from 'react';
import {
  CaretRight,
  ChatCircle,
  DotsThree,
  FilePlus,
  FolderPlus,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react';
import { Button, Popover } from '../../../../../components/ui';
import { useI18n } from '../../../../../i18n';
import type { DirEntry } from '../../../../../types';
import { EntryNameInput } from './EntryNameInput';
import { FileTypeIcon } from './FileTypeIcon';
import { useMutationMessages } from './mutation-messages';

export interface FolderMutation {
  id: number;
  parentPath: string;
}

interface Props {
  path: string;
  selectedPath?: string;
  onSelect: (path: string) => void;
  revision: number;
  mutation?: FolderMutation;
  onAddDirectory?: (path: string) => void;
  onCreate: (parentPath: string, kind: 'file' | 'directory', name: string) => Promise<string | undefined>;
  onRename: (path: string, name: string) => Promise<string | undefined>;
  onTrash: (path: string, name: string) => void;
  requestAction: (action: () => void) => void;
  adding?: boolean;
}

type EditMode = 'file' | 'directory' | 'rename' | null;

export const joinFilePath = (parent: string, name: string): string => `${parent.replace(/[\\/]$/, '')}/${name}`;

const EntryActions = ({ name, path, directory, adding, onAddDirectory, onEdit, onTrash, requestAction }: {
  name: string;
  path: string;
  directory: boolean;
  adding?: boolean;
  onAddDirectory?: () => void;
  onEdit: (mode: Exclude<EditMode, null>) => void;
  onTrash: Props['onTrash'];
  requestAction: Props['requestAction'];
}) => {
  const { t } = useI18n();
  const message = useMutationMessages();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const run = (action: () => void) => {
    setMenuOpen(false);
    requestAction(action);
  };

  return (
    <div className={`folder-browser__entry-actions${menuOpen ? ' folder-browser__entry-actions--open' : ''}`}>
      {directory && <Button variant="icon" size="xs" aria-label={message('newFileIn', { name })}
        title={message('newFileIn', { name })} onClick={() => run(() => onEdit('file'))}>
        <FilePlus size={14} />
      </Button>}
      <Button ref={menuButtonRef} variant="icon" size="xs" aria-label={message('moreActions', { name })}
        title={message('moreActions', { name })} aria-expanded={menuOpen} aria-haspopup="menu"
        onClick={() => setMenuOpen(value => !value)}>
        <DotsThree size={16} weight="bold" />
      </Button>
      {menuOpen && <Popover anchorRef={menuButtonRef} placement="bottom" align="end" gap={4}
        ariaLabel={message('moreActions', { name })} className="folder-browser__action-menu context-menu--in-dock"
        onClose={() => setMenuOpen(false)}>
        {directory && onAddDirectory && <Button size="sm" className="folder-browser__action-menu-item" role="menuitem"
          disabled={adding} onClick={() => { setMenuOpen(false); onAddDirectory(); }}>
          <ChatCircle size={15} /><span>{t('folder.addDirectory', { name })}</span>
        </Button>}
        {directory && <>
          <Button size="sm" className="folder-browser__action-menu-item" role="menuitem"
            onClick={() => run(() => onEdit('file'))}>
            <FilePlus size={15} /><span>{message('newFileIn', { name })}</span>
          </Button>
          <Button size="sm" className="folder-browser__action-menu-item" role="menuitem"
            onClick={() => run(() => onEdit('directory'))}>
            <FolderPlus size={15} /><span>{message('newFolderIn', { name })}</span>
          </Button>
        </>}
        <Button size="sm" className="folder-browser__action-menu-item" role="menuitem"
          onClick={() => run(() => onEdit('rename'))}>
          <PencilSimple size={15} /><span>{message('renameEntry', { name })}</span>
        </Button>
        <div className="folder-browser__action-menu-separator" />
        <Button size="sm" className="folder-browser__action-menu-item folder-browser__action-menu-item--danger" role="menuitem"
          onClick={() => run(() => onTrash(path, name))}>
          <Trash size={15} /><span>{message('trashEntry', { name })}</span>
        </Button>
      </Popover>}
    </div>
  );
};

const DirectoryRow = ({ entry, parent, ...props }: Omit<Props, 'path'> & { entry: DirEntry; parent: string }) => {
  const message = useMutationMessages();
  const [expanded, setExpanded] = useState(false);
  const [childrenMounted, setChildrenMounted] = useState(false);

  // Keep the subtree alive for the exit transition, but do not load closed folders.
  useEffect(() => {
    if (expanded) {
      setChildrenMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setChildrenMounted(false), 200);
    return () => window.clearTimeout(timer);
  }, [expanded]);
  const [editMode, setEditMode] = useState<EditMode>(null);
  const path = joinFilePath(parent, entry.name);
  const submit = async (name: string): Promise<string | undefined> => {
    const error = editMode === 'rename'
      ? await props.onRename(path, name)
      : await props.onCreate(path, editMode === 'directory' ? 'directory' : 'file', name);
    if (!error) {
      if (editMode !== 'rename') setExpanded(true);
      setEditMode(null);
    }
    return error;
  };

  return (
    <div>
      <div className="folder-browser__directory-row folder-browser__entry-row">
        <Button size="xs" className="folder-browser__tree-row" aria-expanded={expanded}
          onClick={() => setExpanded(value => !value)}>
          <CaretRight size={12} className="folder-browser__caret" />
          <span>{entry.name}</span>
        </Button>
        <EntryActions name={entry.name} path={path} directory adding={props.adding}
          onAddDirectory={props.onAddDirectory ? () => props.onAddDirectory?.(path) : undefined}
          onEdit={setEditMode} onTrash={props.onTrash} requestAction={props.requestAction} />
      </div>
      {editMode && <EntryNameInput
        ariaLabel={editMode === 'rename'
          ? message('renameEntry', { name: entry.name })
          : message(editMode === 'file' ? 'newFileName' : 'newFolderName')}
        initialValue={editMode === 'rename' ? entry.name : ''}
        onCancel={() => setEditMode(null)}
        onSubmit={submit}
      />}
      <div className="folder-browser__collapse" data-expanded={expanded} aria-hidden={!expanded}
        ref={element => element?.toggleAttribute('inert', !expanded)}>
        <div className="folder-browser__collapse-inner">
          {childrenMounted && <div className="folder-browser__children">
            <FileTree {...props} path={path} />
          </div>}
        </div>
      </div>
    </div>
  );
};

const FileRow = ({ entry, path, selectedPath, onSelect, onRename, onTrash, requestAction }: {
  entry: DirEntry;
  path: string;
  selectedPath?: string;
  onSelect: Props['onSelect'];
  onRename: Props['onRename'];
  onTrash: Props['onTrash'];
  requestAction: Props['requestAction'];
}) => {
  const message = useMutationMessages();
  const [renaming, setRenaming] = useState(false);
  const filePath = joinFilePath(path, entry.name);
  return <>
    <div className="folder-browser__entry-row">
      <Button size="xs" className="folder-browser__tree-row" aria-pressed={selectedPath === filePath}
        title={entry.name} onClick={() => onSelect(filePath)}>
        <FileTypeIcon name={entry.name} /><span className="folder-browser__file-label">{entry.name}</span>
      </Button>
      <EntryActions name={entry.name} path={filePath} directory={false} onEdit={() => setRenaming(true)}
        onTrash={onTrash} requestAction={requestAction} />
    </div>
    {renaming && <EntryNameInput ariaLabel={message('renameEntry', { name: entry.name })} initialValue={entry.name}
      onCancel={() => setRenaming(false)} onSubmit={async name => {
        const error = await onRename(filePath, name);
        if (!error) setRenaming(false);
        return error;
      }} />}
  </>;
};

export const FileTree = (props: Props) => {
  const { t } = useI18n();
  const [entries, setEntries] = useState<DirEntry[] | null>(null);
  const [error, setError] = useState('');
  const mutationId = props.mutation?.parentPath === props.path ? props.mutation.id : 0;

  useEffect(() => {
    let current = true;
    setError('');
    void window.canvasWorkspace.file.listDir(props.path, 0, true).then(result => {
      if (!current) return;
      if (result.ok) setEntries(result.entries ?? []);
      else setError(result.error || t('folder.readFailed'));
    }).catch(error => { if (current) setError(String(error)); });
    return () => { current = false; };
  }, [props.path, props.revision, mutationId, t]);

  if (error) return <div className="folder-browser__hint" role="alert">{error}</div>;
  if (!entries) return <div className="folder-browser__hint">{t('folder.loading')}</div>;
  if (!entries.length) return <div className="folder-browser__hint">{t('folder.empty')}</div>;
  return <>{entries.map(entry => entry.type === 'dir' ? (
    <DirectoryRow key={entry.name} entry={entry} parent={props.path} {...props} />
  ) : (
    <FileRow key={entry.name} entry={entry} path={props.path} selectedPath={props.selectedPath}
      onSelect={props.onSelect} onRename={props.onRename} onTrash={props.onTrash} requestAction={props.requestAction} />
  ))}</>;
};
