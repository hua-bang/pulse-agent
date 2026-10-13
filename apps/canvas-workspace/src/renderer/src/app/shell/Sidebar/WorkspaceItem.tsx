import type React from 'react';
import { lazy, Suspense, useRef, useState } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import { MoreIcon, WorkspaceIcon } from '../../../components/icons';
import { Button } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { isImeComposing } from '../../../utils/ime';

// The menu (and Popover's positioning hooks) loads on first open, which keeps
// it out of the startup bundle.
const WorkspaceItemMenu = lazy(() => import('./WorkspaceItemMenu').then((m) => ({ default: m.WorkspaceItemMenu })));

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
            <MoreIcon size={16} />
          </Button>
        )}
        {menuOpen && (
          <Suspense fallback={null}>
            <WorkspaceItemMenu
              anchorRef={menuButtonRef}
              label={t('sidebar.workspaceActions', { name: ws.name })}
              canDelete={!isOnlyWorkspace}
              onClose={() => setMenuOpen(false)}
              onRename={() => run(() => onStartRename(ws))}
              onOpenSettings={() => run(() => onOpenSettings(ws.id))}
              onExport={() => run(() => onExport(ws.id))}
              onDelete={() => run(() => onDelete(ws.id))}
            />
          </Suspense>
        )}
      </div>
    </div>
  );
};
