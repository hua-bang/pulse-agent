import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import './App.css';
import { AppShellProvider, useAppShell } from './components/AppShellProvider';
import './components/artifacts/artifacts.css';
import { ChatPageLazy as ChatPage } from './components/chat/lazy';
import { MigrationSpinner } from './components/MigrationSpinner';
import { RightDock, RightDockProvider } from './components/RightDock';
import { Settings, type SettingsSection } from './components/Settings';
import { Sidebar } from './components/Sidebar';
import { WorkspaceSettingsDrawer } from './components/WorkspaceSettings';
import { getRegisteredNavItems, getRegisteredRoutes } from '../../plugins/renderer';
import { Workbench, useWorkbenchState } from './components/Workbench';
import { GraphPageLazy as GraphPage } from './components/WorkspaceNodes/GraphPageLazy';
import { NodeDetailPage } from './components/WorkspaceNodes/NodeDetailPage';
import { NodesPage } from './components/WorkspaceNodes/NodesPage';
import './components/WorkspaceNodes/index.css';
import { useWorkspaces } from './hooks/useWorkspaces';
import { parseCanvasLocation } from './utils/canvasLinks';
import { PulseRouter, PulseRouterView } from './components/router';
import {
  EXPERIMENTAL_FLAG_WORKSPACE_GRAPH,
  EXPERIMENTAL_FLAG_WORKSPACE_NODES,
} from '../../shared/experimental-features';
import { I18nProvider, useI18n } from './i18n';
type SelectedWorkspaceNode = { workspaceId: string; nodeId: string };

const ROUTE_CANVAS = '/';
const ROUTE_CHAT = '/chat';
const ROUTE_NODES = '/nodes';
const ROUTE_GRAPH = '/graph';
const SIDEBAR_COLLAPSED_KEY = 'pulse-canvas.sidebar-collapsed';
const EMPTY_SELECTED_NODE_IDS: string[] = [];

const readSidebarCollapsedPreference = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const stored = window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    // localStorage may be unavailable; default to discoverability.
  }
  return false;
};

const writeSidebarCollapsedPreference = (collapsed: boolean): void => {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? '1' : '0');
  } catch {
    // Preference persistence is best-effort only.
  }
};

// Plugin flags are snapshotted at preload-time, so reading once at module
// init is fine — toggling in Settings only takes effect after a reload.
const PLUGIN_FLAGS =
  (globalThis as { canvasWorkspace?: { pluginFlags?: Record<string, boolean> } })
    .canvasWorkspace?.pluginFlags ?? {};
const NODES_ENABLED = PLUGIN_FLAGS[EXPERIMENTAL_FLAG_WORKSPACE_NODES] === true;
const GRAPH_ENABLED = PLUGIN_FLAGS[EXPERIMENTAL_FLAG_WORKSPACE_GRAPH] === true;

// Plugin routes contribute their own URL paths; activeView widens to
// 'canvas' | 'chat' | <plugin route path>.
type ActiveView = 'canvas' | 'chat' | string;

const AppContent = () => {
  const { t } = useI18n();
  const [location, setLocation] = useLocation();
  const { path: routePath, params: routeParams } = useMemo(
    () => parseCanvasLocation(location),
    [location],
  );
  // Routes and nav items contributed by built-in plugins. Snapshot at
  // mount: built-in plugins register synchronously at renderer bootstrap,
  // so a one-shot read is sufficient.
  const pluginRoutes = useMemo(() => getRegisteredRoutes(), []);
  const pluginNavItems = useMemo(() => getRegisteredNavItems(), []);
  const detailNodeMatch = routePath.match(/^\/nodes\/([^/]+)\/([^/]+)$/);
  // Disabled experimental routes silently fall back to canvas so a stale
  // bookmark / deep link still loads something usable.
  const nodesRouteActive =
    NODES_ENABLED && (routePath === ROUTE_NODES || detailNodeMatch !== null);
  const graphRouteActive = GRAPH_ENABLED && routePath === ROUTE_GRAPH;
  const activeView: ActiveView =
    routePath === ROUTE_CHAT
      ? 'chat'
      : nodesRouteActive
        ? detailNodeMatch
          ? 'node-detail'
          : 'nodes'
        : graphRouteActive
          ? 'graph'
          : pluginRoutes.some((r) => r.path === routePath)
            ? routePath
            : 'canvas';
  const routeQuery = routeParams.toString();

  const { notify, updateToast, confirm, openShortcuts, isOverlayOpen } = useAppShell();

  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsedPreference);
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<SelectedWorkspaceNode | null>(null);
  // null = global Settings drawer closed. Setting to a section name opens
  // the drawer focused on that section.
  const [appSettingsSection, setAppSettingsSection] = useState<SettingsSection | null>(null);
  const openAppSettings = useCallback((section: SettingsSection) => {
    setAppSettingsSection(section);
  }, []);
  const closeAppSettings = useCallback(() => setAppSettingsSection(null), []);

  const handleSidebarToggle = useCallback(() => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      writeSidebarCollapsedPreference(next);
      return next;
    });
  }, []);

  const {
    workspaces,
    folders,
    activeId,
    selectWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setRootFolder,
    importWorkspace,
    createFolder,
    renameFolder,
    deleteFolder,
    toggleFolder,
    moveWorkspace,
    reorderWorkspace,
    reorderFolder,
  } = useWorkspaces();

  const workbench = useWorkbenchState({ activeWorkspaceId: activeId, workspaces });
  const {
    activeNodes,
    selectedNodeIdsByWorkspace,
    ensureWorkspaceNodesLoaded,
    getWorkspaceNodes,
    requestNodeFocus,
    requestActiveNodeFocus,
    requestActiveNodeDelete,
    requestActiveNodeRename,
  } = workbench;
  const activeSelectedNodeIds = selectedNodeIdsByWorkspace[activeId] ?? EMPTY_SELECTED_NODE_IDS;

  useEffect(() => {
    if (!routeQuery || routePath !== ROUTE_CANVAS) return;

    const targetWorkspaceId = routeParams.get('workspaceId') ?? activeId;
    const targetNodeId = routeParams.get('nodeId');
    if (!targetWorkspaceId) return;
    if (!workspaces.some((workspace) => workspace.id === targetWorkspaceId)) return;

    if (activeId !== targetWorkspaceId) {
      selectWorkspace(targetWorkspaceId);
    }
    if (targetNodeId) {
      requestNodeFocus(targetWorkspaceId, targetNodeId);
    }
    setLocation(ROUTE_CANVAS);
  }, [routePath, routeQuery, routeParams, activeId, workspaces, selectWorkspace, requestNodeFocus, setLocation]);

  // If the user reached a disabled experimental route (typically via a
  // bookmarked URL after toggling the flag off), bounce them back to the
  // canvas instead of leaving them on a blank view.
  useEffect(() => {
    if (!NODES_ENABLED && (routePath === ROUTE_NODES || detailNodeMatch)) {
      setLocation(ROUTE_CANVAS);
      return;
    }
    if (!GRAPH_ENABLED && routePath === ROUTE_GRAPH) {
      setLocation(ROUTE_CANVAS);
    }
  }, [routePath, detailNodeMatch, setLocation]);

  const enterChatView = useCallback(() => {
    setLocation(ROUTE_CHAT);
  }, [setLocation]);

  const enterNodesView = useCallback(() => {
    if (!NODES_ENABLED) return;
    setSelectedNode(null);
    setLocation(ROUTE_NODES);
  }, [setLocation]);

  const enterGraphView = useCallback(() => {
    if (!GRAPH_ENABLED) return;
    setLocation(ROUTE_GRAPH);
  }, [setLocation]);

  const exitChatView = useCallback(() => {
    setLocation(ROUTE_CANVAS);
  }, [setLocation]);

  // Plugin nav items declare their own paths; just hand off the URL to
  // the router without the host knowing about specific plugins.
  const navigateToPath = useCallback((path: string) => {
    setLocation(path);
  }, [setLocation]);

  const handleSelectWorkspace = useCallback((id: string) => {
    ensureWorkspaceNodesLoaded(id);
    selectWorkspace(id);
    setLocation(ROUTE_CANVAS);
  }, [ensureWorkspaceNodesLoaded, selectWorkspace, setLocation]);

  useEffect(() => {
    ensureWorkspaceNodesLoaded(activeId);
  }, [activeId, ensureWorkspaceNodesLoaded]);

  const handleCreateWorkspace = useCallback((name: string, folderId?: string) => {
    const trimmed = name.trim() || t('app.untitledWorkspace');
    const id = createWorkspace(name, folderId);
    notify({
      tone: 'success',
      title: t('app.workspaceCreated'),
      description: trimmed,
    });
    return id;
  }, [createWorkspace, notify, t]);

  const handleRenameWorkspace = useCallback((id: string, name: string) => {
    const workspace = workspaces.find((item) => item.id === id);
    const trimmed = name.trim();
    if (!workspace || !trimmed || workspace.name === trimmed) return;
    renameWorkspace(id, trimmed);
    notify({
      tone: 'success',
      title: t('app.workspaceRenamed'),
      description: `${workspace.name} -> ${trimmed}`,
    });
  }, [workspaces, renameWorkspace, notify, t]);

  const handleDeleteWorkspace = useCallback(async (id: string) => {
    const workspace = workspaces.find((item) => item.id === id);
    if (!workspace) return;

    const accepted = await confirm({
      intent: 'danger',
      title: t('app.deleteWorkspaceTitle', { name: workspace.name }),
      description: t('app.deleteWorkspaceDescription'),
      confirmLabel: t('app.deleteWorkspaceConfirm'),
    });
    if (!accepted) return;

    const toastId = notify({
      tone: 'loading',
      title: t('app.deletingWorkspaceTitle', { name: workspace.name }),
      description: t('app.deletingWorkspaceDescription'),
    });

    const result = await deleteWorkspace(id);
    if (!result.ok) {
      updateToast(toastId, {
        tone: 'error',
        title: t('app.workspaceDeletionFailed'),
        description: result.error ?? t('app.workspaceDeletionFailedDescription'),
        autoCloseMs: 4200,
      });
      return;
    }

    updateToast(toastId, {
      tone: 'success',
      title: t('app.workspaceDeleted'),
      description: workspace.name,
      autoCloseMs: 2400,
    });
    if (result.switchedToEmpty) enterChatView();
  }, [workspaces, confirm, notify, updateToast, deleteWorkspace, enterChatView, t]);

  const handleExportWorkspace = useCallback(async (id: string) => {
    const workspace = workspaces.find((item) => item.id === id);
    const api = window.canvasWorkspace?.store;
    if (!workspace || !api) return;

    const toastId = notify({
      tone: 'loading',
      title: t('app.exportingWorkspaceTitle', { name: workspace.name }),
      description: t('app.exportingWorkspaceDescription'),
    });

    const result = await api.exportWorkspace(workspace.id, workspace.name);
    if (!result.ok) {
      if (result.canceled) {
        updateToast(toastId, {
          tone: 'info',
          title: t('app.exportCanceled'),
          description: workspace.name,
          autoCloseMs: 1800,
        });
        return;
      }
      updateToast(toastId, {
        tone: 'error',
        title: t('app.workspaceExportFailed'),
        description: result.error ?? t('app.workspaceExportFailedDescription'),
        autoCloseMs: 4200,
      });
      return;
    }

    updateToast(toastId, {
      tone: 'success',
      title: t('app.workspaceExported'),
      description: result.filePath ?? `${workspace.name} (${result.fileCount ?? 0} files)`,
      autoCloseMs: 3600,
    });
  }, [workspaces, notify, updateToast, t]);

  const handleImportWorkspace = useCallback(async () => {
    const toastId = notify({
      tone: 'loading',
      title: t('app.importingWorkspaceTitle'),
      description: t('app.importingWorkspaceDescription'),
    });

    const result = await importWorkspace();
    if (!result.ok) {
      if (result.canceled) {
        updateToast(toastId, {
          tone: 'info',
          title: t('app.importCanceled'),
          description: t('app.importCanceledDescription'),
          autoCloseMs: 1800,
        });
        return;
      }
      updateToast(toastId, {
        tone: 'error',
        title: t('app.workspaceImportFailed'),
        description: result.error ?? t('app.workspaceImportFailedDescription'),
        autoCloseMs: 4200,
      });
      return;
    }

    updateToast(toastId, {
      tone: 'success',
      title: t('app.workspaceImported'),
      description: `${result.workspace?.name ?? t('app.importedWorkspaceFallback')} (${result.fileCount ?? 0} files)`,
      autoCloseMs: 3000,
    });
    setLocation(ROUTE_CANVAS);
  }, [importWorkspace, notify, updateToast, setLocation, t]);

  const handleSetActiveRootFolder = useCallback(async () => {
    const api = window.canvasWorkspace?.dialog;
    if (!api) {
      notify({
        tone: 'error',
        title: t('app.rootFolderPickerUnavailable'),
        autoCloseMs: 3200,
      });
      return;
    }

    const result = await api.openFolder();
    if (!result.ok || result.canceled || !result.folderPath) return;

    setRootFolder(activeId, result.folderPath);
    notify({
      tone: 'success',
      title: t('app.rootFolderSet'),
      description: result.folderPath,
      autoCloseMs: 3000,
    });
  }, [activeId, notify, setRootFolder, t]);

  const handleCreateFolder = useCallback((name: string) => {
    const trimmed = name.trim() || t('app.untitledFolder');
    const id = createFolder(name);
    notify({
      tone: 'success',
      title: t('app.folderCreated'),
      description: trimmed,
    });
    return id;
  }, [createFolder, notify, t]);

  const handleRenameFolder = useCallback((id: string, name: string) => {
    const folder = folders.find((item) => item.id === id);
    const trimmed = name.trim();
    if (!folder || !trimmed || folder.name === trimmed) return;
    renameFolder(id, trimmed);
    notify({
      tone: 'success',
      title: t('app.folderRenamed'),
      description: `${folder.name} -> ${trimmed}`,
    });
  }, [folders, renameFolder, notify, t]);

  const handleDeleteFolder = useCallback(async (id: string) => {
    const folder = folders.find((item) => item.id === id);
    if (!folder) return;

    const accepted = await confirm({
      intent: 'danger',
      title: t('app.deleteFolderTitle', { name: folder.name }),
      description: t('app.deleteFolderDescription'),
      confirmLabel: t('app.deleteFolderConfirm'),
    });
    if (!accepted) return;

    deleteFolder(id);
    notify({
      tone: 'success',
      title: t('app.folderDeleted'),
      description: t('app.folderDeletedDescription', { name: folder.name }),
    });
  }, [folders, confirm, deleteFolder, notify, t]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditable = Boolean(target) && (
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable
      );

      if (isOverlayOpen) return;

      if (!isEditable && (e.key === '?' || (e.shiftKey && e.key === '/'))) {
        e.preventDefault();
        openShortcuts();
        return;
      }

      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        if (activeView === 'chat') {
          setLocation(ROUTE_CANVAS);
        } else {
          setLocation(ROUTE_CHAT);
        }
        return;
      }

      if (e.key === 'Escape' && activeView === 'chat' && !isEditable) {
        setLocation(ROUTE_CANVAS);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeView, isOverlayOpen, openShortcuts, setLocation]);


  const getWorkspaceRootFolder = useCallback((workspaceId: string) => {
    return workspaces.find((ws) => ws.id === workspaceId)?.rootFolder;
  }, [workspaces]);

  const handleNodeFocusFromChatPage = useCallback((workspaceId: string, nodeId: string) => {
    if (activeId !== workspaceId) {
      selectWorkspace(workspaceId);
    }
    requestNodeFocus(workspaceId, nodeId);
    setLocation(ROUTE_CANVAS);
  }, [activeId, selectWorkspace, requestNodeFocus, setLocation]);

  const openNodePage = useCallback((workspaceId: string, nodeId: string) => {
    setSelectedNode({ workspaceId, nodeId });
    setLocation(`${ROUTE_NODES}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(nodeId)}`);
  }, [setLocation]);

  return (
    <div className="app">
      <div className="app-body">
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={handleSidebarToggle}
          workspaces={workspaces}
          folders={folders}
          activeId={activeId}
          onSelect={handleSelectWorkspace}
          onCreate={handleCreateWorkspace}
          onRename={handleRenameWorkspace}
          onDelete={handleDeleteWorkspace}
          onExport={handleExportWorkspace}
          onOpenSettings={setSettingsWorkspaceId}
          onOpenAppSettings={() => openAppSettings('models')}
          onImport={handleImportWorkspace}
          onCreateFolder={handleCreateFolder}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onToggleFolder={toggleFolder}
          onMoveWorkspace={moveWorkspace}
          onReorderWorkspace={reorderWorkspace}
          onReorderFolder={reorderFolder}
          activeNodes={activeNodes}
          onNodeFocus={requestActiveNodeFocus}
          onNodeDelete={requestActiveNodeDelete}
          onNodeRename={requestActiveNodeRename}
          activeView={activeView}
          onEnterChat={enterChatView}
          onEnterNodes={enterNodesView}
          onEnterGraph={enterGraphView}
          nodesEnabled={NODES_ENABLED}
          graphEnabled={GRAPH_ENABLED}
          pluginNavItems={pluginNavItems}
          onNavigate={navigateToPath}
          onExitChat={exitChatView}
          selectedNodeIds={activeSelectedNodeIds}
        />
        <PulseRouter<ActiveView> activeKey={activeView}>
          <PulseRouterView name='canvas' keepAlive>
            <Workbench
              activeWorkspaceId={activeId}
              workspaces={workspaces}
              controller={workbench}
              onSelectWorkspace={handleSelectWorkspace}
              onOpenAppSettings={openAppSettings}
              onOpenWorkspaceSettings={setSettingsWorkspaceId}
              onSetActiveRootFolder={handleSetActiveRootFolder}
            />
          </PulseRouterView>
          <PulseRouterView name="chat">
            <ChatPage
              allWorkspaces={workspaces}
              getWorkspaceNodes={getWorkspaceNodes}
              getWorkspaceRootFolder={getWorkspaceRootFolder}
              onWorkspaceContextRequest={ensureWorkspaceNodesLoaded}
              onExit={exitChatView}
              onNodeFocus={handleNodeFocusFromChatPage}
              onOpenAppSettings={openAppSettings}
              onOpenWorkspaceSettings={setSettingsWorkspaceId}
            />
          </PulseRouterView>
          {NODES_ENABLED && (
            <PulseRouterView name="nodes">
              <NodesPage
                workspaces={workspaces}
                selectedNode={selectedNode}
                onSelectNode={setSelectedNode}
                onOpenNode={openNodePage}
                onOpenAppSettings={openAppSettings}
              />
            </PulseRouterView>
          )}
          {NODES_ENABLED && (
            <PulseRouterView name="node-detail">
              <NodeDetailPage
                workspaceId={detailNodeMatch ? decodeURIComponent(detailNodeMatch[1]) : ''}
                nodeId={detailNodeMatch ? decodeURIComponent(detailNodeMatch[2]) : null}
                workspaces={workspaces}
                onBack={enterNodesView}
              />
            </PulseRouterView>
          )}
          {GRAPH_ENABLED && (
            <PulseRouterView name="graph">
              <GraphPage
                workspaces={workspaces}
                selectedNode={selectedNode}
                onSelectNode={setSelectedNode}
                onOpenNode={openNodePage}
                onOpenAppSettings={openAppSettings}
              />
            </PulseRouterView>
          )}
          {pluginRoutes.map((route) => {
            return (
              <PulseRouterView key={route.path} name={route.path}>
                <route.Component />
              </PulseRouterView>
            );
          })}
        </PulseRouter>
      </div>
      <RightDock activeWorkspaceId={activeId} chatTabEnabled={activeView === 'canvas'} />
      <MigrationSpinner />
      <WorkspaceSettingsDrawer
        workspace={
          settingsWorkspaceId
            ? workspaces.find((ws) => ws.id === settingsWorkspaceId) ?? null
            : null
        }
        onClose={() => setSettingsWorkspaceId(null)}
        onRename={renameWorkspace}
        onSetRootFolder={setRootFolder}
      />
      <Settings
        open={appSettingsSection !== null}
        initialSection={appSettingsSection ?? 'models'}
        onClose={closeAppSettings}
      />
    </div>
  );
};

const App = () => (
  <I18nProvider>
    <AppShellProvider>
      <RightDockProvider>
        <AppContent />
      </RightDockProvider>
    </AppShellProvider>
  </I18nProvider>
);

export default App;
