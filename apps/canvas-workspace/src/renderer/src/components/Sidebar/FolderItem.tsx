import type React from 'react';
import type { FolderEntry, WorkspaceEntry } from '../../hooks/useWorkspaces';
import { CloseIcon, ChevronRightIcon, FolderIcon, PencilIcon, PlusIcon } from '../icons';
import { useI18n } from '../../i18n';

interface FolderItemProps {
  folder: FolderEntry;
  folderWorkspaces: WorkspaceEntry[];
  isRenaming: boolean;
  renameValue: string;
  renameFolderInputRef: React.RefObject<HTMLInputElement>;
  isWsDrop: boolean;
  isFolderDrop: boolean;
  onFolderDragStart: (e: React.DragEvent, folderId: string) => void;
  onFolderDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onToggle: () => void;
  onStartRename: () => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onDelete: () => void;
  onCreateWorkspace: () => void;
  renderWorkspace: (ws: WorkspaceEntry) => React.ReactNode;
  inlineCreateSlot?: React.ReactNode;
}

export const FolderItem = ({
  folder,
  folderWorkspaces,
  isRenaming,
  renameValue,
  renameFolderInputRef,
  isWsDrop,
  isFolderDrop,
  onFolderDragStart,
  onFolderDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  onToggle,
  onStartRename,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onDelete,
  onCreateWorkspace,
  renderWorkspace,
  inlineCreateSlot,
}: FolderItemProps) => {
  const { t } = useI18n();
  const isOpen = !folder.collapsed;

  return (
    <div
      className={`sidebar-folder${isFolderDrop ? ' sidebar-folder--drop-target' : ''}`}
      draggable
      onDragStart={(e) => onFolderDragStart(e, folder.id)}
      onDragEnd={onFolderDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="sidebar-folder-header">
        {isRenaming ? (
          <input
            ref={renameFolderInputRef}
            className="sidebar-rename-input"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameCommit();
              if (e.key === 'Escape') onRenameCancel();
            }}
          />
        ) : (
          <button
            className="sidebar-folder-toggle"
            onClick={onToggle}
            title={t('sidebar.toggleFolder')}
          >
            <span className={`sidebar-folder-chevron${isOpen ? ' sidebar-folder-chevron--open' : ''}`}>
              <ChevronRightIcon size={10} />
            </span>
            <span className="sidebar-folder-icon">
              <FolderIcon size={14} open={isOpen} strokeWidth={isOpen ? 1.1 : 1.2} />
            </span>
            <span className="sidebar-folder-name">{folder.name}</span>
          </button>
        )}
        {!isRenaming && (
          <div className="sidebar-folder-actions">
            <button
              className="sidebar-folder-action"
              onClick={(e) => { e.stopPropagation(); onCreateWorkspace(); }}
              title={t('sidebar.newWorkspaceInFolder')}
              aria-label={t('sidebar.newWorkspaceInFolder')}
            >
              <PlusIcon size={12} strokeWidth={1.5} />
            </button>
            <button
              className="sidebar-folder-action"
              onClick={(e) => { e.stopPropagation(); onStartRename(); }}
              title={t('sidebar.renameFolder')}
              aria-label={t('sidebar.renameFolder')}
            >
              <PencilIcon size={12} strokeWidth={1.4} />
            </button>
            <button
              className="sidebar-folder-action sidebar-folder-action--danger"
              onClick={(e) => { e.stopPropagation(); onDelete(); }}
              title={t('sidebar.deleteFolder')}
              aria-label={t('sidebar.deleteFolder')}
            >
              <CloseIcon size={12} strokeWidth={1.5} />
            </button>
          </div>
        )}
      </div>

      <div
        className={`sidebar-folder-children${!isOpen ? ' sidebar-folder-children--collapsed' : ''}${isWsDrop ? ' sidebar-drop-zone--active' : ''}`}
        aria-hidden={!isOpen}
      >
        <div className="sidebar-folder-children-inner">
          {folderWorkspaces.map(renderWorkspace)}
          {inlineCreateSlot}
          {folderWorkspaces.length === 0 && !inlineCreateSlot && (
            <div className="sidebar-folder-empty">{t('sidebar.dropWorkspacesHere')}</div>
          )}
        </div>
      </div>
    </div>
  );
};
