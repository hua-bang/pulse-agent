import { useCallback, useRef } from 'react';
import type React from 'react';
import {
  PlusIcon,
  WorkspaceIcon,
  FolderIcon,
  ImportIcon,
  NodeGraphIcon,
} from '../../../components/icons';
import { Button } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { useMenuKeyboardNav } from '../../../hooks/useMenuKeyboardNav';

interface SidebarHeaderProps {
  showAddMenu: boolean;
  onToggleAddMenu: () => void;
  onCloseAddMenu: () => void;
  addMenuRef: React.RefObject<HTMLDivElement>;
  onNewWorkspace: () => void;
  onNewFolder: () => void;
  onImportWorkspace: () => void;
  onJoinSharedWorkspace?: () => void;
}

/** Workspaces title with the add menu, over the wide rail's tree. */
export const SidebarHeader = ({
  showAddMenu,
  onToggleAddMenu,
  onCloseAddMenu,
  addMenuRef,
  onNewWorkspace,
  onNewFolder,
  onImportWorkspace,
  onJoinSharedWorkspace,
}: SidebarHeaderProps) => {
  const { t, language } = useI18n();
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeAddMenuAndRestoreFocus = useCallback(() => {
    onCloseAddMenu();
    addButtonRef.current?.focus();
  }, [onCloseAddMenu]);

  useMenuKeyboardNav(menuRef, closeAddMenuAndRestoreFocus, showAddMenu);

  const handleAddButtonKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      event.preventDefault();
      event.stopPropagation();
      if (!showAddMenu) {
        onToggleAddMenu();
        return;
      }
      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
      );
      const target = event.key === 'ArrowUp' ? items[items.length - 1] : items[0];
      target?.focus();
    },
    [onToggleAddMenu, showAddMenu],
  );

  return (
    <div className="sidebar-section-header">
      <span className="sidebar-section-title">{t('sidebar.workspaces')}</span>
      <div className="sidebar-section-actions" ref={addMenuRef}>
        <button
          ref={addButtonRef}
          type="button"
          className="sidebar-section-btn"
          onClick={onToggleAddMenu}
          onKeyDown={handleAddButtonKeyDown}
          title={t('sidebar.addWorkspaceOrFolder')}
          aria-label={t('sidebar.addWorkspaceOrFolder')}
          aria-haspopup="menu"
          aria-expanded={showAddMenu}
          aria-controls={showAddMenu ? 'sidebar-add-menu' : undefined}
        >
          <PlusIcon size={14} />
        </button>
        {showAddMenu && (
          <div
            ref={menuRef}
            id="sidebar-add-menu"
            className="sidebar-add-menu"
            role="menu"
            aria-label={t('sidebar.addMenuLabel')}
          >
            <button
              type="button"
              className="sidebar-add-menu-item"
              role="menuitem"
              onClick={onNewWorkspace}
            >
              <WorkspaceIcon size={14} />
              <span>{t('sidebar.newWorkspace')}</span>
            </button>
            <button
              type="button"
              className="sidebar-add-menu-item"
              role="menuitem"
              onClick={onNewFolder}
            >
              <FolderIcon size={14} />
              <span>{t('sidebar.newFolder')}</span>
            </button>
            <button
              type="button"
              className="sidebar-add-menu-item"
              role="menuitem"
              onClick={onImportWorkspace}
            >
              <ImportIcon size={14} />
              <span>{t('sidebar.importWorkspace')}</span>
            </button>
            {onJoinSharedWorkspace && (
              <Button
                size="sm"
                className="sidebar-add-menu-item"
                role="menuitem"
                onClick={onJoinSharedWorkspace}
              >
                <NodeGraphIcon size={14} />
                <span>{language === 'zh' ? '加入共享画布…' : 'Join Shared Canvas…'}</span>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
