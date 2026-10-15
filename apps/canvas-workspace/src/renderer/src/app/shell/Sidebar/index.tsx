import { lazy, Suspense, useEffect, useState } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import './index.css';
import './interaction-polish.css';
import { SidebarHeader } from './SidebarHeader';
import { SidebarRail } from './SidebarRail';
import { WorkspaceItem } from './WorkspaceItem';
import { WorkspaceList } from './WorkspaceList';
import { useSidebarEditing } from './useSidebarEditing';
import { useSidebarDrag } from './useSidebarDrag';
import type { SidebarProps as Props } from './types';

const LayerSection = lazy(() => import('./LayerSection').then((module) => ({ default: module.LayerSection })));

export const Sidebar = ({
  collapsed,
  onToggle,
  railExpanded,
  onToggleRail,
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
  onEnterHome,
  onEnterCanvas,
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
  activeMcpAppKey = null,
  onOpenMcpApp,
}: Props) => {
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

  const workspaceHeader = (
    <SidebarHeader
      showAddMenu={editing.showAddMenu}
      onToggleAddMenu={() => editing.setShowAddMenu((v) => !v)}
      onCloseAddMenu={() => editing.setShowAddMenu(false)}
      addMenuRef={editing.addMenuRef}
      onNewWorkspace={() => editing.startCreate('workspace')}
      onNewFolder={() => editing.startCreate('folder')}
      onImportWorkspace={editing.importWorkspace}
    />
  );

  const workspaceList = (
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
  );

  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}${railExpanded ? ' sidebar--rail-expanded' : ''}`}>
      <SidebarRail
        activeView={activeView}
        panelCollapsed={collapsed}
        onTogglePanel={onToggle}
        expanded={railExpanded}
        onToggleExpanded={onToggleRail}
        onEnterHome={onEnterHome}
        onEnterCanvas={onEnterCanvas}
        onEnterNodes={onEnterNodes}
        onEnterGraph={onEnterGraph}
        onEnterSkills={onEnterSkills}
        onEnterScheduled={onEnterScheduled}
        onOpenAppSettings={onOpenAppSettings}
        nodesEnabled={nodesEnabled}
        graphEnabled={graphEnabled}
        enableSkills={enableSkills}
        enableScheduled={enableScheduled}
        pluginNavItems={pluginNavItems}
        onNavigate={onNavigate}
        activeMcpAppKey={activeMcpAppKey}
        onOpenMcpApp={onOpenMcpApp}
        tree={railExpanded ? (
          <div className="sidebar-rail-tree">
            {workspaceHeader}
            {workspaceList}
          </div>
        ) : undefined}
      />
      <div className="sidebar-panel" hidden={collapsed}>
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
      </div>
    </aside>
  );
};
