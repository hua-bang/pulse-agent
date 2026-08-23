import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import './App.css';
import { AppShellProvider, useAppShell } from './components/shell/AppShellProvider';
import { ConversationCompletionToastBridge } from './components/chat/ConversationCompletionToastBridge';
import { DeferredSettings } from './components/shell/AppLazyBoundaries';
import { ChatPageLazy as ChatPage } from './components/chat/lazy';
import { isCanvasTabEditingAllowed, isDockChatTabEnabled, isGlobalChatLauncherVisible, RightDock, RightDockProvider, useChatDockWorkspace, useRightDock } from './components/dock/RightDock';
import { GlobalChatLauncher } from './components/dock/RightDock/GlobalChatLauncher';
import type { SettingsSection } from './components/settings/Settings';
import { Sidebar } from './components/shell/Sidebar';
import { getRegisteredNavItems, getRegisteredRoutes } from '../../plugins/renderer';
import { Workbench, useWorkbenchState } from './components/shell/Workbench';
import { resolveKnowledgeChatRouteContext } from './components/shell/Workbench/knowledgeChatContext';
import { GraphPageLazy as GraphPage } from './views/WorkspaceNodes/GraphPageLazy';
import { useKnowledgeAiContext } from './views/WorkspaceNodes/knowledgeAiContext';
import { NodesRouteViews } from './views/WorkspaceNodes/NodesRouteViews';
import { useNodeDetailBridges } from './views/WorkspaceNodes/useNodeDetailBridges';
import { useWorkspaces } from './hooks/useWorkspaces';
import { useAppShortcutBindings } from './hooks/useAppShortcuts';
import { parseCanvasLocation } from './utils/canvasLinks';
import { PulseRouter, PulseRouterView } from './components/shell/router';
import { EXPERIMENTAL_FLAG_WORKSPACE_GRAPH, EXPERIMENTAL_FLAG_WORKSPACE_NODES } from '../../shared/experimental-features';
import { I18nProvider, useI18n } from './i18n';
import type { KnowledgeNodeSelection } from './types';
import { ScheduledRouteViews, SkillsRouteView } from './components/shell/RouteViews';
import { useScheduledRunChatOpener } from './views/Scheduled/useScheduledRunChatOpener';
import {
  ChatTargetProvider,
  useActiveChatTarget,
  useChatTargetBroker,
} from './components/chat/ChatTargetContext';
import { useChatNavigation } from './components/chat/hooks/useChatNavigation';
import type { AgentScope } from './components/chat/types';
const MigrationSpinner = lazy(() => import('./components/shell/MigrationSpinner').then((module) => ({ default: module.MigrationSpinner })));
const ROUTE_CANVAS = '/', ROUTE_CHAT = '/chat', ROUTE_NODES = '/nodes', ROUTE_GRAPH = '/graph', ROUTE_SKILLS = '/skills', ROUTE_SCHEDULED = '/scheduled';
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
const PLUGIN_FLAGS =
  (globalThis as { canvasWorkspace?: { pluginFlags?: Record<string, boolean> } })
    .canvasWorkspace?.pluginFlags ?? {};
const NODES_ENABLED = PLUGIN_FLAGS[EXPERIMENTAL_FLAG_WORKSPACE_NODES] === true, NODES_NAV_VISIBLE = false;
const GRAPH_ENABLED = PLUGIN_FLAGS[EXPERIMENTAL_FLAG_WORKSPACE_GRAPH] === true, GRAPH_NAV_VISIBLE = false;
type ActiveView = 'canvas' | 'chat' | string;
const AppContent = () => {
  const { t } = useI18n();
  const dock = useRightDock();
  const [location, setLocation] = useLocation();
  const { path: routePath, params: routeParams } = useMemo(() => parseCanvasLocation(location), [location]);
  // so a one-shot read is sufficient.
  const pluginRoutes = useMemo(() => getRegisteredRoutes(), []);
  const pluginNavItems = useMemo(() => getRegisteredNavItems(), []);
  const detailNodeMatch = routePath.match(/^\/nodes\/([^/]+)\/([^/]+)$/);
  const scheduledTaskMatch = routePath.match(/^\/scheduled\/([^/]+)$/);
  const detailNode: KnowledgeNodeSelection | null = detailNodeMatch
    ? { workspaceId: decodeURIComponent(detailNodeMatch[1]), nodeId: decodeURIComponent(detailNodeMatch[2]) }
    : null;
  // Disabled experimental routes silently fall back to canvas so a stale
  // bookmark / deep link still loads something usable.
  const nodesRouteActive =
    NODES_ENABLED && (routePath === ROUTE_NODES || detailNodeMatch !== null);
  const graphRouteActive = GRAPH_ENABLED && routePath === ROUTE_GRAPH;
  const activeView: ActiveView =
    routePath === ROUTE_CHAT ? 'chat'
      : routePath === ROUTE_SKILLS ? 'skills'
        : scheduledTaskMatch ? 'scheduled-task'
          : routePath === ROUTE_SCHEDULED ? 'scheduled'
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
  const chatTargetBroker = useChatTargetBroker();
  const activeChatTarget = useActiveChatTarget();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsedPreference);
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string | null>(null);
  const [workspaceSettingsLoaded, setWorkspaceSettingsLoaded] = useState(false);
  const [selectedNode, setSelectedNode] = useState<KnowledgeNodeSelection | null>(null);
  const [nodeDetailBackPath, setNodeDetailBackPath] = useState<string | null>(null);
  const {
    explicitContext: knowledgeChatExplicitContext,
    askAi: handleAskKnowledgeAi,
    removeContext: handleRemoveKnowledgeChatContext,
    consumeComposerRequest: handleKnowledgeComposerRequestHandled,
  } = useKnowledgeAiContext({ openChat: dock.openChat, summarizePrompt: t('workspaceNodes.aiSummarizePrompt') });
  const knowledgeChatContext = resolveKnowledgeChatRouteContext({
    activeView,
    selectedNode,
    detailNode,
    explicitContext: knowledgeChatExplicitContext ?? undefined,
  });
  // null = global Settings drawer closed; a section name opens that section.
  const [appSettingsSection, setAppSettingsSection] = useState<SettingsSection | null>(null);
  const [appSettingsLoaded, setAppSettingsLoaded] = useState(false);
  const openAppSettings = useCallback((section: SettingsSection) => {
    setAppSettingsLoaded(true);
    setAppSettingsSection(section);
  }, []);
  const closeAppSettings = useCallback(() => setAppSettingsSection(null), []);
  const openWorkspaceSettings = useCallback((workspaceId: string) => {
    setWorkspaceSettingsLoaded(true);
    setSettingsWorkspaceId(workspaceId);
  }, []);
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
    activeId, activeIdReady,
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
    handleNodesChange, handleSelectionChange,
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

  const {
    enterChatTarget,
    enterChatView,
    exitChatView,
    initialTarget: chatEntryTarget,
  } = useChatNavigation({
    activeView,
    location,
    setLocation,
    activeTarget: activeChatTarget,
    broker: chatTargetBroker,
    openDockChat: dock.openChat,
    isOverlayOpen,
    openShortcuts,
  });
  const { dockWorkspaceId, reportChatWorkspace, activateDockWorkspace } = useChatDockWorkspace(activeView, activeId, chatEntryTarget?.scope, selectWorkspace);
  const openSessionInOwningScope = useCallback(async (
    scope: AgentScope,
    sessionId: string,
    scopeLabel: string,
  ) => {
    const { createChatPageSessionTarget } = await import('./components/chat/utils/sessionScope');
    enterChatTarget(createChatPageSessionTarget(scope, sessionId, scopeLabel));
  }, [enterChatTarget]);
  const enterNodesView = useCallback(() => {
    if (!NODES_ENABLED) return;
    setSelectedNode(null);
    setNodeDetailBackPath(null);
    setLocation(ROUTE_NODES);
  }, [setLocation]);

  const exitNodeDetailView = useCallback(() => {
    if (nodeDetailBackPath) {
      setNodeDetailBackPath(null);
      setLocation(nodeDetailBackPath);
      return;
    }
    enterNodesView();
  }, [enterNodesView, nodeDetailBackPath, setLocation]);

  const enterGraphView = useCallback(() => {
    if (!GRAPH_ENABLED) return;
    setLocation(ROUTE_GRAPH);
  }, [setLocation]);

  // Plugin nav items declare their own paths; just hand off the URL to
  // the router without the host knowing about specific plugins.
  const navigateToPath = useCallback((path: string) => {
    setLocation(path);
  }, [setLocation]);

  useScheduledRunChatOpener({ activeView, chatRoute: ROUTE_CHAT, onOpenSessionInScope: openSessionInOwningScope });

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

  useAppShortcutBindings({
    activeView, isOverlayOpen, openShortcuts, toggleSidebar: handleSidebarToggle,
    workspaces, selectWorkspace: handleSelectWorkspace, setLocation, routes: { canvas: ROUTE_CANVAS, chat: ROUTE_CHAT },
  });

  const getWorkspaceRootFolder = useCallback((workspaceId: string) => workspaces.find((ws) => ws.id === workspaceId)?.rootFolder, [workspaces]);

  const focusNodeOnCanvas = useCallback((workspaceId: string, nodeId: string) => {
    if (activeId !== workspaceId) {
      selectWorkspace(workspaceId);
    }
    requestNodeFocus(workspaceId, nodeId);
    setLocation(ROUTE_CANVAS);
  }, [activeId, selectWorkspace, requestNodeFocus, setLocation]);

  const openNodePage = useCallback((workspaceId: string, nodeId: string) => {
    setSelectedNode({ workspaceId, nodeId });
    setNodeDetailBackPath(location);
    setLocation(`${ROUTE_NODES}/${encodeURIComponent(workspaceId)}/${encodeURIComponent(nodeId)}`);
  }, [location, setLocation]);
  useNodeDetailBridges({ activeWorkspaceId: activeId, enabled: NODES_ENABLED, pageNode: detailNode, enterNodePage: dock.enterNodePage, openNodePage, focusNodeOnCanvas });
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
          onOpenSettings={openWorkspaceSettings}
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
          onEnterSkills={() => setLocation(ROUTE_SKILLS)}
          onEnterScheduled={() => setLocation(ROUTE_SCHEDULED)}
          nodesEnabled={NODES_NAV_VISIBLE && NODES_ENABLED}
          graphEnabled={GRAPH_NAV_VISIBLE && GRAPH_ENABLED}
          pluginNavItems={pluginNavItems}
          onNavigate={navigateToPath}
          onExitChat={exitChatView}
          selectedNodeIds={activeSelectedNodeIds}
        />
        <PulseRouter<ActiveView> activeKey={activeView}>
          <PulseRouterView name='canvas' keepAlive>
            <Workbench
              activeWorkspaceId={activeId}
              canvasHostActive={activeView === 'canvas'}
              workspaces={workspaces}
              controller={workbench}
              knowledgeChatContext={knowledgeChatContext}
              onRemoveKnowledgeChatContext={handleRemoveKnowledgeChatContext}
              onKnowledgeComposerRequestHandled={handleKnowledgeComposerRequestHandled}
              onSelectWorkspace={handleSelectWorkspace}
              onActivateWorkspace={selectWorkspace}
              onOpenAppSettings={openAppSettings}
              onOpenWorkspaceSettings={openWorkspaceSettings}
              onOpenSessionInScope={openSessionInOwningScope}
              onSetActiveRootFolder={handleSetActiveRootFolder}
            />
          </PulseRouterView>
          <PulseRouterView name="chat">
            <ChatPage
              allWorkspaces={workspaces}
              openScheduledTaskId={routeParams.get('scheduledTask')}
              initialTarget={chatEntryTarget}
              getWorkspaceNodes={getWorkspaceNodes}
              getWorkspaceRootFolder={getWorkspaceRootFolder}
              onWorkspaceContextRequest={ensureWorkspaceNodesLoaded}
              onWorkspaceScopeChange={reportChatWorkspace}
              onExit={exitChatView}
              onNodeFocus={focusNodeOnCanvas}
              onOpenAppSettings={openAppSettings}
            />
          </PulseRouterView>
          <NodesRouteViews enabled={NODES_ENABLED} workspaces={workspaces} detailNode={detailNode} onBack={exitNodeDetailView} onAskAi={handleAskKnowledgeAi} />
          {GRAPH_ENABLED && (
            <PulseRouterView name="graph">
              <GraphPage workspaces={workspaces} selectedNode={selectedNode} onSelectNode={setSelectedNode} />
            </PulseRouterView>
          )}
          <SkillsRouteView activeWorkspaceId={activeId} workspaces={workspaces}
            onSelectWorkspace={(workspaceId) => { ensureWorkspaceNodesLoaded(workspaceId); selectWorkspace(workspaceId); }}
          />
          <ScheduledRouteViews scheduledTaskId={scheduledTaskMatch ? decodeURIComponent(scheduledTaskMatch[1]) : null}
            onExitScheduledTask={() => setLocation(ROUTE_SCHEDULED)} onOpenAppSettings={openAppSettings}
            onOpenSessionInScope={openSessionInOwningScope} />
          {pluginRoutes.map((route) => {
            return (
              <PulseRouterView key={route.path} name={route.path}>
                <route.Component />
              </PulseRouterView>
            );
          })}
        </PulseRouter>
      </div>
      <GlobalChatLauncher visible={isGlobalChatLauncherVisible(activeView)} />
      <RightDock workspaces={workspaces} activeWorkspaceId={dockWorkspaceId} activeIdReady={activeIdReady} chatTabEnabled={isDockChatTabEnabled(activeView)} canvasTabEditingAllowed={isCanvasTabEditingAllowed(activeView)} onCanvasNodesChange={handleNodesChange} onCanvasSelectionChange={handleSelectionChange} reserveSpace={activeView !== 'skills'} capWidth={activeView !== 'canvas'} pageMinAppWidth={(sidebarCollapsed ? 48 : 240) + 440} onOpenNodePage={openNodePage} onActivateWorkspace={activateDockWorkspace} />
      <Suspense fallback={null}><MigrationSpinner /></Suspense>
      <DeferredSettings
        appLoaded={appSettingsLoaded}
        appSection={appSettingsSection}
        workspaceLoaded={workspaceSettingsLoaded}
        workspaceId={settingsWorkspaceId}
        workspaces={workspaces}
        onCloseApp={closeAppSettings}
        onCloseWorkspace={() => setSettingsWorkspaceId(null)}
        onRenameWorkspace={renameWorkspace}
        onSetRootFolder={setRootFolder}
      />
    </div>
  );
};
const App = () => (
  <I18nProvider>
    <AppShellProvider>
      <ConversationCompletionToastBridge />
      <ChatTargetProvider>
        <RightDockProvider><AppContent /></RightDockProvider>
      </ChatTargetProvider>
    </AppShellProvider>
  </I18nProvider>
);
export default App;
