import type React from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { CloseIcon, ExportIcon, PencilIcon, SettingsIcon, WorkspaceIcon } from '../icons';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';

export interface WorkspaceItemProps {
  ws: WorkspaceEntry;
  activeId: string;
  activeView: string;
  isOnlyWorkspace: boolean;
  isRenaming: boolean;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement>;
  isDropBefore: boolean;
  onSelect: (id: string) => void;
  onStartRename: (ws: WorkspaceEntry) => void;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onDelete: (id: string) => void;
  onExport: (id: string) => void;
  onOpenSettings: (id: string) => void;
  onDragStart: (e: React.DragEvent, id: string) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onReorderDragOver: (e: React.DragEvent) => void;
  onReorderDragLeave: (e: React.DragEvent) => void;
  onReorderDrop: (e: React.DragEvent) => void;
}

export const WorkspaceItem = ({
  ws,
  activeId,
  activeView,
  isOnlyWorkspace,
  isRenaming,
  renameValue,
  renameInputRef,
  isDropBefore,
  onSelect,
  onStartRename,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onDelete,
  onExport,
  onOpenSettings,
  onDragStart,
  onDragEnd,
  onReorderDragOver,
  onReorderDragLeave,
  onReorderDrop,
}: WorkspaceItemProps) => {
  const { t } = useI18n();

  return (
    <div
      className={`sidebar-workspace-entry${isDropBefore ? ' sidebar-workspace-entry--drop-before' : ''}`}
      draggable
      onDragStart={(e) => onDragStart(e, ws.id)}
      onDragEnd={onDragEnd}
      onDragOver={onReorderDragOver}
      onDragLeave={onReorderDragLeave}
      onDrop={onReorderDrop}
    >
      <div className="sidebar-item-row">
        {isRenaming ? (
          <input
            ref={renameInputRef}
            className="sidebar-rename-input"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={(e) => {
              if (isImeComposing(e)) return;
              if (e.key === 'Enter') onRenameCommit();
              if (e.key === 'Escape') onRenameCancel();
            }}
          />
        ) : (
          <button
            className={`sidebar-item${activeId === ws.id && activeView === 'canvas' ? ' sidebar-item--active' : ''}`}
            onClick={() => onSelect(ws.id)}
            title={ws.name}
          >
            <span className="sidebar-item-icon">
              <WorkspaceIcon size={14} />
            </span>
            <span className="sidebar-item-name">{ws.name}</span>
          </button>
        )}
        {!isRenaming && (
          <button className="sidebar-item-export" onClick={() => onExport(ws.id)} title={t('sidebar.exportWorkspace')}>
            <ExportIcon size={12} strokeWidth={1.5} />
          </button>
        )}
        {!isRenaming && (
          <button
            className="sidebar-item-rename"
            onClick={() => onStartRename(ws)}
            title={t('sidebar.rename')}
            aria-label={t('sidebar.renameWorkspace')}
          >
            <PencilIcon size={12} strokeWidth={1.4} />
          </button>
        )}
        {!isRenaming && (
          <button
            className="sidebar-item-settings"
            onClick={() => onOpenSettings(ws.id)}
            title={t('sidebar.workspaceSettings')}
            aria-label={t('sidebar.workspaceSettings')}
          >
            <SettingsIcon size={12} strokeWidth={1.4} />
          </button>
        )}
        {!isOnlyWorkspace && !isRenaming && (
          <button className="sidebar-item-delete" onClick={() => onDelete(ws.id)} title={t('sidebar.delete')}>
            <CloseIcon size={12} strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
};
