import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import './index.css';
import { AppShellProvider, useAppShell } from '../shell/AppShellProvider';
import { ConversationCompletionToastBridge } from '../shell/ConversationCompletionToastBridge';
import { DeferredSettings } from '../shell/AppLazyBoundaries';
import { ChatPageLazy as ChatPage } from '../../modules/chat/lazy';
import { GlobalChatLauncher, isCanvasTabEditingAllowed, isDockChatTabEnabled, isGlobalChatLauncherVisible, RightDock, RightDockProvider, useChatDockWorkspace, useRightDock } from '../../modules/dock';
import type { SettingsSection } from '../../modules/settings';
import { Sidebar } from '../shell/Sidebar';
import { getRegisteredNavItems, getRegisteredRoutes } from '../../../../plugins/renderer';
import { Workbench, useWorkbenchState } from '../shell/Workbench';
import { resolveKnowledgeChatRouteContext } from '../shell/Workbench/knowledgeChatContext';
import { GraphPageLazy as GraphPage } from '../../modules/workspace-nodes/surface';
import { useKnowledgeAiContext, useNodeDetailBridges } from '../../modules/workspace-nodes';
import { useWorkspaces } from '../../hooks/useWorkspaces';
import { useAppShortcutBindings } from '../../hooks/useAppShortcuts';
import { PulseRouter, PulseRouterView } from '../shell/router';
import { EXPERIMENTAL_FLAG_WORKSPACE_GRAPH, EXPERIMENTAL_FLAG_WORKSPACE_NODES } from '../../../../shared/experimental-features';
import { I18nProvider, useI18n } from '../../i18n';
import type { KnowledgeNodeSelection } from '../../types';
import { NodesRouteViews, PluginMarketRouteView, ScheduledRouteViews, SkillsRouteView } from '../shell/RouteViews';
import { useScheduledRunChatOpener } from '../../modules/scheduled';
import {
  ChatTargetProvider,
  useActiveChatTarget,
  useChatTargetBroker,
} from '../../modules/chat';
import { useChatNavigation } from '../shell/router/useChatNavigation';
import type { AgentScope } from '../../types';
import { APP_ROUTES, resolveAppRoute, type AppActiveView as ActiveView } from './routeModel';
import { useWorkspaceActions } from './useWorkspaceActions';
const MigrationSpinner = lazy(() => import('../shell/MigrationSpinner').then((module) => ({ default: module.MigrationSpinner })));
const {
  canvas: ROUTE_CANVAS,
  chat: ROUTE_CHAT,
  nodes: ROUTE_NODES,
  graph: ROUTE_GRAPH,
  plugins: ROUTE_PLUGINS,
  skills: ROUTE_SKILLS,
  scheduled: ROUTE_SCHEDULED,
} = APP_ROUTES;
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
const AppContent = () => {
  const { t } = useI18n();
  const dock = useRightDock();
  const [location, setLocation] = useLocation();
  // so a one-shot read is sufficient.
  const pluginRoutes = useMemo(() => getRegisteredRoutes(), []);
  const pluginNavItems = useMemo(() => getRegisteredNavItems(), []);
  const route = useMemo(() => resolveAppRoute(location, {
    nodesEnabled: NODES_ENABLED,
    graphEnabled: GRAPH_ENABLED,
    pluginPaths: pluginRoutes.map((item) => item.path),
  }), [location, pluginRoutes]);
  const {
    path: routePath,
    params: routeParams,
    query: routeQuery,
    activeView,
    detailNode,
    scheduledTaskId,
    redirectToCanvas,
  } = route;
  const { openShortcuts, isOverlayOpen } = useAppShell();
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

  const workspaceStore = useWorkspaces();
  const {
    workspaces,
    folders,
    activeId, activeIdReady,
    selectWorkspace,
    renameWorkspace,
    setRootFolder,
    toggleFolder,
    moveWorkspace,
    reorderWorkspace,
    reorderFolder,
  } = workspaceStore;

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
    if (redirectToCanvas) setLocation(ROUTE_CANVAS);
  }, [redirectToCanvas, setLocation]);

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
  const workspaceActions = useWorkspaceActions({
    store: workspaceStore,
    ensureWorkspaceNodesLoaded,
    enterChatView,
    setLocation,
    canvasRoute: ROUTE_CANVAS,
  });
  const { dockWorkspaceId, reportChatWorkspace, activateDockWorkspace } = useChatDockWorkspace(activeView, activeId, chatEntryTarget?.scope, selectWorkspace);
  const openSessionInOwningScope = useCallback(async (
    scope: AgentScope,
    sessionId: string,
    scopeLabel: string,
  ) => {
    const { createChatPageSessionTarget } = await import('../../modules/chat/session');
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

  useEffect(() => {
    ensureWorkspaceNodesLoaded(activeId);
  }, [activeId, ensureWorkspaceNodesLoaded]);

  useAppShortcutBindings({
    activeView, isOverlayOpen, openShortcuts, toggleSidebar: handleSidebarToggle,
    workspaces, selectWorkspace: workspaceActions.select, setLocation, routes: { canvas: ROUTE_CANVAS, chat: ROUTE_CHAT },
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
          onSelect={workspaceActions.select}
          onCreate={workspaceActions.create}
          onRename={workspaceActions.rename}
          onDelete={workspaceActions.remove}
          onExport={workspaceActions.exportWorkspace}
          onOpenSettings={openWorkspaceSettings}
          onOpenAppSettings={() => openAppSettings('models')}
          onImport={workspaceActions.importWorkspace}
          onCreateFolder={workspaceActions.createFolder}
          onRenameFolder={workspaceActions.renameFolder}
          onDeleteFolder={workspaceActions.removeFolder}
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
          onEnterSkills={() => setLocation(ROUTE_PLUGINS)}
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
              onSelectWorkspace={workspaceActions.select}
              onActivateWorkspace={selectWorkspace}
              onOpenAppSettings={openAppSettings}
              onOpenWorkspaceSettings={openWorkspaceSettings}
              onOpenSessionInScope={openSessionInOwningScope}
              onSetActiveRootFolder={workspaceActions.setActiveRootFolder}
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
            onNavigatePlugins={() => setLocation(ROUTE_PLUGINS)} />
          <PulseRouterView name="plugins"><PluginMarketRouteView onNavigateSkills={() => setLocation(ROUTE_SKILLS)} onOpenSettings={() => openAppSettings('plugins')} /></PulseRouterView>
          <ScheduledRouteViews scheduledTaskId={scheduledTaskId}
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
      <RightDock workspaces={workspaces} activeWorkspaceId={dockWorkspaceId} activeIdReady={activeIdReady} chatTabEnabled={isDockChatTabEnabled(activeView)} canvasTabEditingAllowed={isCanvasTabEditingAllowed(activeView)} onCanvasNodesChange={handleNodesChange} onCanvasSelectionChange={handleSelectionChange} reserveSpace capWidth={activeView !== 'canvas'} pageMinAppWidth={(sidebarCollapsed ? 48 : 240) + 440} onOpenNodePage={openNodePage} onActivateWorkspace={activateDockWorkspace} />
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
