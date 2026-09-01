import { useCallback, useRef } from 'react';
import type React from 'react';
import { SidebarSimple } from '@phosphor-icons/react';
import type { NavItem } from '../../../../../plugins/types';
import {
  PlusIcon,
  AppLogoIcon,
  WorkspaceIcon,
  FolderIcon,
  ImportIcon,
  KnowledgeStoreIcon,
  NodeGraphIcon,
  PluginIcon,
  ScheduledIcon,
} from '../../icons';
import { useI18n } from '../../../i18n';
import { useMenuKeyboardNav } from '../../../hooks/useMenuKeyboardNav';
import { Button } from '../../ui';

export const SidebarToggleIcon = ({ size = 14 }: { size?: number }) => (
  <SidebarSimple size={size} weight="regular" />
);

interface SidebarHeaderProps {
  onToggle: () => void;
  activeView: string;
  onEnterChat: () => void;
  onEnterNodes: () => void;
  onEnterGraph: () => void;
  onEnterSkills: () => void;
  onEnterScheduled: () => void;
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

  enableSkills?: boolean;
  enableScheduled?: boolean;
}

export const SidebarHeader = ({
  onToggle,
  activeView,
  onEnterChat,
  onEnterNodes,
  onEnterGraph,
  onEnterSkills,
  onEnterScheduled,
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
  enableScheduled = true,
  enableSkills = true
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

      <div className="sidebar-nav">
        <button
          className={`sidebar-nav-item${activeView === 'chat' ? ' sidebar-nav-item--active' : ''}`}
          onClick={onEnterChat}
          title={t('sidebar.aiChatTitle')}
        >
          <span className="sidebar-nav-icon">
            <AppLogoIcon size={20} />
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
        {enableSkills ? <Button
          variant="secondary"
          className={`sidebar-nav-item${activeView === 'skills' || activeView === 'plugins' ? ' sidebar-nav-item--active' : ''}`}
          onClick={onEnterSkills}
          title={t('sidebar.skillsTitle')}
        >
          <span className="sidebar-nav-icon">
            <PluginIcon size={15} />
          </span>
          <span className="sidebar-nav-label">{t('sidebar.skills')}</span>
        </Button> : null}

        {
          enableScheduled ? <Button
            variant="secondary"
            className={`sidebar-nav-item${activeView === 'scheduled' || activeView === 'scheduled-task' ? ' sidebar-nav-item--active' : ''}`}
            onClick={onEnterScheduled}
            title={t('sidebar.scheduledTitle')}
          >
            <span className="sidebar-nav-icon">
              <ScheduledIcon size={15} />
            </span>
            <span className="sidebar-nav-label">{t('sidebar.scheduled')}</span>
          </Button> : null
        }

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
