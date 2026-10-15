import { useCallback, useRef } from 'react';
import type React from 'react';
import { SidebarSimple } from '@phosphor-icons/react';
import {
  PlusIcon,
  WorkspaceIcon,
  FolderIcon,
  ImportIcon,
} from '../../../components/icons';
import { useI18n } from '../../../i18n';
import { useMenuKeyboardNav } from '../../../hooks/useMenuKeyboardNav';
import { Button } from '../../../components/ui';

export const SidebarToggleIcon = ({ size = 14 }: { size?: number }) => (
  <SidebarSimple size={size} weight="regular" />
);

interface SidebarHeaderProps {
  onToggle: () => void;
  showAddMenu: boolean;
  onToggleAddMenu: () => void;
  onCloseAddMenu: () => void;
  addMenuRef: React.RefObject<HTMLDivElement>;
  onNewWorkspace: () => void;
  onNewFolder: () => void;
  onImportWorkspace: () => void;
  /** The brand row with the collapse control. */
  brand?: boolean;
}

/**
 * Header of the workspace panel: brand, collapse control, and the add menu.
 * The wide rail shows only the add menu over its tree; the panel then holds
 * only Layers, so it has no brand row.
 */
export const SidebarHeader = ({
  onToggle,
  showAddMenu,
  onToggleAddMenu,
  onCloseAddMenu,
  addMenuRef,
  onNewWorkspace,
  onNewFolder,
  onImportWorkspace,
  brand = true,
}: SidebarHeaderProps) => {
  const { t } = useI18n();
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
    <>
      {brand && (
        <div className="sidebar-brand-header">
          <span className="sidebar-brand">Pulse Canvas</span>
          <Button
            variant="icon"
            size="xs"
            className="sidebar-section-btn"
            onClick={onToggle}
            title={t('sidebar.collapse')}
            aria-label={t('sidebar.collapse')}
          >
            <SidebarToggleIcon size={14} />
          </Button>
        </div>
      )}

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
            </div>
          )}
        </div>
      </div>
    </>
  );
};
