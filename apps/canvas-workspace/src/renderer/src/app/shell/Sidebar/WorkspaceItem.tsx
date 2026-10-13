import type React from 'react';
import { useRef, useState } from 'react';
import { DotsThree } from '@phosphor-icons/react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import { CloseIcon, ExportIcon, PencilIcon, SettingsIcon, WorkspaceIcon } from '../../../components/icons';
import { Button, Popover } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { isImeComposing } from '../../../utils/ime';

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
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // One "more" button keeps the name readable on hover; four inline
  // actions cut most names down to a few characters.
  const run = (action: () => void) => {
    setMenuOpen(false);
    action();
  };
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
          <Button
            ref={menuButtonRef}
            variant="icon"
            size="xs"
            className={`sidebar-item-more${menuOpen ? ' sidebar-item-more--open' : ''}`}
            title={t('sidebar.workspaceActions', { name: ws.name })}
            aria-label={t('sidebar.workspaceActions', { name: ws.name })}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <DotsThree size={16} weight="bold" />
          </Button>
        )}
        {menuOpen && (
          <Popover
            anchorRef={menuButtonRef}
            placement="bottom"
            align="end"
            gap={4}
            ariaLabel={t('sidebar.workspaceActions', { name: ws.name })}
            className="sidebar-item-menu"
            onClose={() => setMenuOpen(false)}
          >
            <Button
              size="sm"
              className="sidebar-item-menu-item sidebar-item-rename"
              role="menuitem"
              onClick={() => run(() => onStartRename(ws))}
            >
              <PencilIcon size={13} strokeWidth={1.4} />
              <span>{t('sidebar.renameWorkspace')}</span>
            </Button>
            <Button
              size="sm"
              className="sidebar-item-menu-item sidebar-item-settings"
              role="menuitem"
              onClick={() => run(() => onOpenSettings(ws.id))}
            >
              <SettingsIcon size={13} strokeWidth={1.4} />
              <span>{t('sidebar.workspaceSettings')}</span>
            </Button>
            <Button
              size="sm"
              className="sidebar-item-menu-item sidebar-item-export"
              role="menuitem"
              onClick={() => run(() => onExport(ws.id))}
            >
              <ExportIcon size={13} strokeWidth={1.5} />
              <span>{t('sidebar.exportWorkspace')}</span>
            </Button>
            {!isOnlyWorkspace && (
              <>
                <div className="sidebar-item-menu-separator" />
                <Button
                  size="sm"
                  className="sidebar-item-menu-item sidebar-item-menu-item--danger sidebar-item-delete"
                  role="menuitem"
                  onClick={() => run(() => onDelete(ws.id))}
                >
                  <CloseIcon size={13} strokeWidth={1.5} />
                  <span>{t('sidebar.delete')}</span>
                </Button>
              </>
            )}
          </Popover>
        )}
      </div>
    </div>
  );
};
