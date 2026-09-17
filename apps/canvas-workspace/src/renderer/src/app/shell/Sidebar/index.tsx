import { lazy, Suspense, useEffect, useState } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import './index.css';
import './interaction-polish.css';
import { SidebarHeader, SidebarToggleIcon } from './SidebarHeader';
import { WorkspaceItem } from './WorkspaceItem';
import { WorkspaceList } from './WorkspaceList';
import { AppLogoIcon, PluginIcon, ScheduledIcon, SettingsIcon } from '../../../components/icons';
import { Button } from '../../../components/ui';
import { useI18n } from '../../../i18n';
import { useSidebarEditing } from './useSidebarEditing';
import { useSidebarDrag } from './useSidebarDrag';
import type { SidebarProps as Props } from './types';

const LayerSection = lazy(() => import('./LayerSection').then((module) => ({ default: module.LayerSection })));

export const Sidebar = ({
  collapsed,
  onToggle,
  workspaces,
  folders,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onExport,
  onOpenSettings,
  onOpenAppSettings,
  onImport,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onToggleFolder,
  onMoveWorkspace,
  onReorderWorkspace,
  onReorderFolder,
  activeNodes = [],
  selectedNodeIds = [],
  onNodeFocus,
  onNodeDelete,
  onNodeRename,
  activeView,
  onEnterChat,
  pluginNavItems,
  onNavigate,
  onEnterNodes,
  onEnterGraph,
  nodesEnabled,
  graphEnabled,
  onEnterSkills,
  onEnterScheduled,
  enableSkills = true,
  enableScheduled = true,
}: Props) => {
  const { t } = useI18n();
  const editing = useSidebarEditing({
    folders, onCreate, onRename, onCreateFolder, onRenameFolder, onToggleFolder, onImport,
  });
  const drag = useSidebarDrag({ onMoveWorkspace, onReorderWorkspace, onReorderFolder });
  const layersVisible = !collapsed && activeView === 'canvas' && activeNodes.length > 0;
  const [layersLoaded, setLayersLoaded] = useState(layersVisible);
  // Load the canvas-only interaction surface on demand, then keep its state
  // mounted across sidebar collapse and route changes.
  useEffect(() => {
    if (layersVisible) setLayersLoaded(true);
  }, [layersVisible]);

  const renderWorkspaceItem = (ws: WorkspaceEntry) => (
    <WorkspaceItem
      key={ws.id}
      ws={ws}
      activeId={activeId}
      activeView={activeView}
      isOnlyWorkspace={workspaces.length <= 1}
      isRenaming={editing.renamingId === ws.id}
      renameValue={editing.renameValue}
      renameInputRef={editing.renameInputRef}
      isDropBefore={drag.wsDropBeforeId === ws.id}
      onSelect={onSelect}
      onStartRename={editing.startRename}
      onRenameChange={editing.setRenameValue}
      onRenameCommit={editing.commitRename}
      onRenameCancel={() => editing.setRenamingId(null)}
      onDelete={onDelete}
      onExport={onExport}
      onOpenSettings={onOpenSettings}
      onDragStart={drag.handleWsDragStart}
      onDragEnd={drag.handleWsDragEnd}
      onReorderDragOver={(e) => drag.handleWsReorderDragOver(e, ws.id)}
      onReorderDragLeave={(e) => drag.handleWsReorderDragLeave(e, ws.id)}
      onReorderDrop={(e) => drag.handleWsReorderDrop(e, ws)}
    />
  );

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>
      {!collapsed && (
        <>
          <SidebarHeader
            onToggle={onToggle}
            activeView={activeView}
            onEnterChat={onEnterChat}
            onEnterNodes={onEnterNodes}
            onEnterGraph={onEnterGraph}
            onEnterSkills={onEnterSkills}
            onEnterScheduled={onEnterScheduled}
            nodesEnabled={nodesEnabled}
            graphEnabled={graphEnabled}
            pluginNavItems={pluginNavItems}
            onNavigate={onNavigate}
            showAddMenu={editing.showAddMenu}
            onToggleAddMenu={() => editing.setShowAddMenu((v) => !v)}
            onCloseAddMenu={() => editing.setShowAddMenu(false)}
            addMenuRef={editing.addMenuRef}
            onNewWorkspace={() => editing.startCreate('workspace')}
            onNewFolder={() => editing.startCreate('folder')}
            onImportWorkspace={editing.importWorkspace}
            enableSkills={enableSkills}
            enableScheduled={enableScheduled}
          />
          <WorkspaceList
            folders={folders}
            workspaces={workspaces}
            dropTarget={drag.dropTarget}
            folderDropTarget={drag.folderDropTarget}
            renamingFolderId={editing.renamingFolderId}
            renameFolderValue={editing.renameFolderValue}
            renameFolderInputRef={editing.renameFolderInputRef}
            inlineCreate={editing.inlineCreate}
            inlineCreateValue={editing.inlineCreateValue}
            inlineCreateRef={editing.inlineCreateRef}
            inlineCreateFolderId={editing.inlineCreateFolderId}
            onFolderDragStart={drag.handleFolderDragStart}
            onFolderDragEnd={drag.handleFolderDragEnd}
            onFolderCombinedDragOver={drag.onFolderCombinedDragOver}
            onFolderCombinedDragLeave={drag.onFolderCombinedDragLeave}
            onFolderCombinedDrop={drag.onFolderCombinedDrop}
            onRootDragOver={(e) => drag.handleWsDragOver(e, '__root__')}
            onRootDragLeave={(e) => drag.handleWsDragLeave(e, '__root__')}
            onRootDrop={(e) => drag.handleWsDrop(e, undefined)}
            onToggleFolder={onToggleFolder}
            onStartFolderRename={editing.startFolderRename}
            onFolderRenameChange={editing.setRenameFolderValue}
            onFolderRenameCommit={editing.commitFolderRename}
            onFolderRenameCancel={() => editing.setRenamingFolderId(null)}
            onDeleteFolder={onDeleteFolder}
            onCreateWorkspaceInFolder={editing.startCreateInFolder}
            renderWorkspace={renderWorkspaceItem}
            onInlineCreateChange={editing.setInlineCreateValue}
            onInlineCreateCommit={editing.commitInlineCreate}
            onInlineCreateCancel={editing.cancelInlineCreate}
          />
        </>
      )}

      {(layersLoaded || layersVisible) && (
        <Suspense fallback={null}>
          <LayerSection
            visible={layersVisible}
            activeId={activeId}
            activeNodes={activeNodes}
            selectedNodeIds={selectedNodeIds}
            onNodeFocus={onNodeFocus}
            onNodeRename={onNodeRename}
            onNodeDelete={onNodeDelete}
          />
        </Suspense>
      )}

      {collapsed && (
        <div className="sidebar-collapsed-rail">
          <button
            type="button"
            className="sidebar-collapsed-btn"
            onClick={onToggle}
            title={t('sidebar.expand')}
            aria-label={t('sidebar.expand')}
          >
            <SidebarToggleIcon size={14} />
          </button>
          <button
            type="button"
            className={`sidebar-collapsed-btn${activeView === 'chat' ? ' sidebar-collapsed-btn--active' : ''}`}
            onClick={onEnterChat}
            title={t('sidebar.aiChatTitle')}
            aria-label={t('sidebar.aiChat')}
          >
            <AppLogoIcon size={20} />
          </button>
          {
            enableSkills ? <Button
              variant="icon"
              className={`sidebar-collapsed-btn${activeView === 'skills' ? ' sidebar-collapsed-btn--active' : ''}`}
              onClick={onEnterSkills}
              title={t('sidebar.skillsTitle')}
              aria-label={t('sidebar.skills')}
            >
              <PluginIcon size={15} />
            </Button> : null
          }
          {
            enableScheduled ? (<Button
              variant="icon"
              className={`sidebar-collapsed-btn${activeView === 'scheduled' || activeView === 'scheduled-task' ? ' sidebar-collapsed-btn--active' : ''}`}
              onClick={onEnterScheduled}
              title={t('sidebar.scheduledTitle')}
              aria-label={t('sidebar.scheduled')}
            >
              <ScheduledIcon size={15} />
            </Button>) : null
          }

          <button
            type="button"
            className="sidebar-collapsed-btn"
            onClick={onOpenAppSettings}
            title={t('sidebar.settings')}
            aria-label={t('sidebar.openSettings')}
          >
            <SettingsIcon size={14} strokeWidth={1.4} />
          </button>
        </div>
      )}

      {!collapsed && (
        <div className="sidebar-footer">
          <button
            type="button"
            className="sidebar-footer-btn"
            onClick={onOpenAppSettings}
            title={t('sidebar.settings')}
            aria-label={t('sidebar.openSettings')}
          >
            <SettingsIcon size={14} strokeWidth={1.4} />
            <span>{t('sidebar.settings')}</span>
          </button>
        </div>
      )}
    </aside>
  );
};
