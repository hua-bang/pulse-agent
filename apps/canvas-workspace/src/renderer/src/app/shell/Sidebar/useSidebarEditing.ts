import { useEffect, useRef, useState } from 'react';
import type { WorkspaceEntry, FolderEntry } from '../../../shared/workspaces';
import { useClickOutside } from '../../../hooks/useClickOutside';
import type { SidebarProps } from './types';

type Options = Pick<SidebarProps,
  'folders' | 'onCreate' | 'onRename' | 'onCreateFolder' | 'onRenameFolder' | 'onToggleFolder' | 'onImport'
>;

export const useSidebarEditing = ({
  folders,
  onCreate,
  onRename,
  onCreateFolder,
  onRenameFolder,
  onToggleFolder,
  onImport,
}: Options) => {
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);
  const [renameFolderValue, setRenameFolderValue] = useState('');
  const [inlineCreate, setInlineCreate] = useState<'workspace' | 'folder' | null>(null);
  const [inlineCreateValue, setInlineCreateValue] = useState('');
  const [inlineCreateFolderId, setInlineCreateFolderId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameFolderInputRef = useRef<HTMLInputElement>(null);
  const inlineCreateRef = useRef<HTMLInputElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);
  useEffect(() => {
    if (renamingFolderId && renameFolderInputRef.current) {
      renameFolderInputRef.current.focus();
      renameFolderInputRef.current.select();
    }
  }, [renamingFolderId]);
  useEffect(() => {
    if (inlineCreate && inlineCreateRef.current) inlineCreateRef.current.focus();
  }, [inlineCreate]);

  useClickOutside(addMenuRef, () => setShowAddMenu(false), showAddMenu);

  const startRename = (ws: WorkspaceEntry) => {
    setRenamingId(ws.id);
    setRenameValue(ws.name);
  };
  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue);
    setRenamingId(null);
  };
  const startFolderRename = (f: FolderEntry) => {
    setRenamingFolderId(f.id);
    setRenameFolderValue(f.name);
  };
  const commitFolderRename = () => {
    if (renamingFolderId && renameFolderValue.trim()) onRenameFolder(renamingFolderId, renameFolderValue);
    setRenamingFolderId(null);
  };
  const commitInlineCreate = () => {
    const v = inlineCreateValue.trim();
    if (v) {
      if (inlineCreate === 'workspace') onCreate(v, inlineCreateFolderId ?? undefined);
      else if (inlineCreate === 'folder') onCreateFolder(v);
    }
    setInlineCreate(null);
    setInlineCreateValue('');
    setInlineCreateFolderId(null);
  };
  const cancelInlineCreate = () => {
    setInlineCreate(null);
    setInlineCreateValue('');
    setInlineCreateFolderId(null);
  };
  const startCreateInFolder = (folderId: string) => {
    const folder = folders.find((f) => f.id === folderId);
    if (folder?.collapsed) onToggleFolder(folderId);
    setShowAddMenu(false);
    setInlineCreate('workspace');
    setInlineCreateValue('');
    setInlineCreateFolderId(folderId);
  };

  const startCreate = (kind: 'workspace' | 'folder') => {
    setShowAddMenu(false);
    setInlineCreate(kind);
    setInlineCreateValue('');
    setInlineCreateFolderId(null);
  };

  const importWorkspace = () => {
    setShowAddMenu(false);
    onImport();
  };

  return {
    renamingId,
    setRenamingId,
    renameValue,
    setRenameValue,
    renamingFolderId,
    setRenamingFolderId,
    renameFolderValue,
    setRenameFolderValue,
    inlineCreate,
    inlineCreateValue,
    setInlineCreateValue,
    inlineCreateFolderId,
    showAddMenu,
    setShowAddMenu,
    renameInputRef,
    renameFolderInputRef,
    inlineCreateRef,
    addMenuRef,
    startRename,
    commitRename,
    startFolderRename,
    commitFolderRename,
    commitInlineCreate,
    cancelInlineCreate,
    startCreateInFolder,
    startCreate,
    importWorkspace,
  };
};
