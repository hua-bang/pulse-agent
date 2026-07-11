import { useCallback, useRef } from 'react';
import type React from 'react';
import type { NavItem } from '../../../../plugins/types';
import {
  PlusIcon,
  AvatarIcon,
  AppLogoIcon,
  WorkspaceIcon,
  FolderIcon,
  ImportIcon,
  KnowledgeStoreIcon,
  NodeGraphIcon,
} from '../icons';
import { useI18n } from '../../i18n';
import { useMenuKeyboardNav } from '../../hooks/useMenuKeyboardNav';

export const SidebarToggleIcon = ({ size = 14 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
    <rect x="1.5" y="2.5" width="13" height="11" rx="2" stroke="currentColor" strokeWidth="1.3" />
    <path d="M6 2.5v11" stroke="currentColor" strokeWidth="1.3" />
  </svg>
);

interface Props {
  onToggle: () => void;
  activeView: string;
  onEnterChat: () => void;
  onEnterNodes: () => void;
  onEnterGraph: () => void;
  nodesEnabled: boolean;
  graphEnabled: boolean;
  pluginNavItems: ReadonlyArray<NavItem>;
  onNavigate: (path: string) => void;
  showAddMenu: boolean;
  onToggleAddMenu: () => void;
  onCloseAddMenu: () => void;
  addMenuRef: React.RefObject<HTMLDivElement>;
  onNewWorkspace: () => void;
  onNewFolder: () => void;
  onImportWorkspace: () => void;
}

export const SidebarHeader = ({
  onToggle,
  activeView,
  onEnterChat,
  onEnterNodes,
  onEnterGraph,
  nodesEnabled,
  graphEnabled,
  pluginNavItems,
  onNavigate,
  showAddMenu,
  onToggleAddMenu,
  onCloseAddMenu,
  addMenuRef,
  onNewWorkspace,
  onNewFolder,
  onImportWorkspace,
}: Props) => {
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
      <div className="sidebar-brand-header">
        <span className="sidebar-brand-mark" aria-hidden="true">
          <AppLogoIcon size={22} />
        </span>
        <span className="sidebar-brand">Pulse Canvas</span>
        <button className="sidebar-section-btn" onClick={onToggle} title={t('sidebar.collapse')}>
          <SidebarToggleIcon size={14} />
        </button>
      </div>

      <div className="sidebar-nav">
        <button
          className={`sidebar-nav-item${activeView === 'chat' ? ' sidebar-nav-item--active' : ''}`}
          onClick={onEnterChat}
          title={t('sidebar.aiChatTitle')}
        >
          <span className="sidebar-nav-icon">
            <AvatarIcon size={14} />
          </span>
          <span className="sidebar-nav-label">{t('sidebar.aiChat')}</span>
        </button>
        {nodesEnabled && (
          <button
            className={`sidebar-nav-item${activeView === 'nodes' || activeView === 'node-detail' ? ' sidebar-nav-item--active' : ''}`}
            onClick={onEnterNodes}
            title={t('sidebar.nodesTitle')}
          >
            <span className="sidebar-nav-icon">
              <KnowledgeStoreIcon size={14} />
            </span>
            <span className="sidebar-nav-label">{t('sidebar.nodes')}</span>
          </button>
        )}
        {graphEnabled && (
          <button
            className={`sidebar-nav-item${activeView === 'graph' ? ' sidebar-nav-item--active' : ''}`}
            onClick={onEnterGraph}
            title={t('sidebar.graphTitle')}
          >
            <span className="sidebar-nav-icon">
              <NodeGraphIcon size={14} />
            </span>
            <span className="sidebar-nav-label">{t('sidebar.graph')}</span>
          </button>
        )}
        {pluginNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              className={`sidebar-nav-item${activeView === item.path ? ' sidebar-nav-item--active' : ''}`}
              onClick={() => onNavigate(item.path)}
              title={item.title ?? item.label}
            >
              {Icon && (
                <span className="sidebar-nav-icon">
                  <Icon size={14} />
                </span>
              )}
              <span className="sidebar-nav-label">{item.label}</span>
            </button>
          );
        })}
      </div>

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
