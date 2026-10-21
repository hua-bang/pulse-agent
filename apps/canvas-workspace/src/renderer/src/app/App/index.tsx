import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearch } from 'wouter';
import './index.css';
import { AppShellProvider, useAppShell } from '../shell/AppShellProvider';
import { ConversationCompletionToastBridge } from '../shell/ConversationCompletionToastBridge';
import { DeferredSettings } from '../shell/AppLazyBoundaries';
import { GlobalChatLauncher, isCanvasTabEditingAllowed, isDockChatTabEnabled, isGlobalChatLauncherVisible, RightDock, RightDockProvider, useChatDockWorkspace, useRightDock } from '../../modules/dock';
import { Sidebar } from '../shell/Sidebar';
import { getRegisteredNavItems, getRegisteredRoutes } from '../../../../plugins/renderer';
import { Workbench, useWorkbenchState } from '../shell/Workbench';
import { resolveKnowledgeChatRouteContext } from '../shell/Workbench/knowledgeChatContext';
import { GraphPageLazy as GraphPage } from '../../modules/workspace-nodes/surface';
import { useKnowledgeAiContext, useNodeDetailBridges } from '../../modules/workspace-nodes';
import { useWorkspaces } from '../workspaces/useWorkspaces';
import { useAppShortcutBindings } from '../shortcuts/useAppShortcuts';
import { usePanelsToggle } from '../shortcuts/usePanelsToggle';
import { useRailExpanded, useSettingsNavigation, useSidebarCollapsed } from './useShellNavigation';
import { PulseRouter, PulseRouterView } from '../shell/router';
import { EXPERIMENTAL_FLAG_WORKSPACE_GRAPH, EXPERIMENTAL_FLAG_WORKSPACE_NODES } from '../../../../shared/experimental-features';
import { I18nProvider, useI18n } from '../../i18n';
import type { AgentContextScheduledTaskRef, KnowledgeNodeSelection, ScheduledTask } from '../../types';
import { HomeRouteView, NodesRouteViews, PluginMarketRouteView, preloadRoutePages, ScheduledRouteViews, SettingsRouteView, SkillsRouteView } from '../shell/RouteViews';
import type { SettingsSection } from '../../modules/settings';
import { useScheduledRunChatOpener } from '../../modules/scheduled';
import {
  ChatTargetProvider,
  useActiveChatTarget,
  useChatTargetBroker,
} from '../../modules/chat';
import { useChatNavigation } from '../shell/router/useChatNavigation';
import type { AgentScope } from '../../types';
import { APP_ROUTES, MCP_APP_VIEW, mcpAppRoutePath, resolveAppRoute, telemetryPageName, type AppActiveView as ActiveView } from './routeModel';
import { globalMcpAppKey, globalMcpAppsStore, useGlobalMcpApps } from '../../modules/mcp-apps/global-apps';
import type { McpAppEntrypointListing } from '../../../../shared/mcp-apps';
import { useWorkspaceActions } from './useWorkspaceActions';
import { setApprovalNodePreviewLoader } from '../../shared/approvalNodePreview';
// The app host pulls in McpAppFrame; keep it out of the startup chunk.
setApprovalNodePreviewLoader(() => import('../../modules/canvas/preview').then((module) => ({
  default: module.CanvasApprovalNodePreview,
})));

const GlobalMcpAppsView = lazy(() => import('../../modules/mcp-apps').then((module) => ({ default: module.GlobalMcpAppsView })));
const WorkspaceTabs = lazy(() => import('../shell/WorkspaceTabs').then((module) => ({ default: module.WorkspaceTabs })));
// Its knowledge @ list loads every workspace's nodes, so it stays off the startup chunk.
const ChatRoute = lazy(() => import('./ChatRoute').then((module) => ({ default: module.ChatRoute })));
const MigrationSpinner = lazy(() => import('../shell/MigrationSpinner').then((module) => ({ default: module.MigrationSpinner })));
const TelemetryNoticeBridge = lazy(() => import('../shell/TelemetryNoticeBridge').then((module) => ({ default: module.TelemetryNoticeBridge })));
const {
  canvas: ROUTE_CANVAS,
  chat: ROUTE_CHAT,
  nodes: ROUTE_NODES,
  graph: ROUTE_GRAPH,
  plugins: ROUTE_PLUGINS,
  skills: ROUTE_SKILLS,
  scheduled: ROUTE_SCHEDULED,
  home: ROUTE_HOME,
} = APP_ROUTES;
/** Match `--sidebar-collapsed` (rail) and `--sidebar-width` (rail + panel) in styles.css and `.sidebar--rail-expanded`. */
const SIDEBAR_PANEL_WIDTH = 224, SIDEBAR_RAIL_WIDTH = 48, SIDEBAR_RAIL_EXPANDED_WIDTH = 240;
const EMPTY_SELECTED_NODE_IDS: string[] = [];
const PLUGIN_FLAGS =
  (globalThis as { canvasWorkspace?: { pluginFlags?: Record<string, boolean> } })
    .canvasWorkspace?.pluginFlags ?? {};
const NODES_ENABLED = PLUGIN_FLAGS[EXPERIMENTAL_FLAG_WORKSPACE_NODES] === true;
const GRAPH_ENABLED = PLUGIN_FLAGS[EXPERIMENTAL_FLAG_WORKSPACE_GRAPH] === true, GRAPH_NAV_VISIBLE = false;
const AppContent = () => {
  const { t } = useI18n();
  const dock = useRightDock();
  const [location, setLocation] = useLocation();
  const search = useSearch();
  // so a one-shot read is sufficient.
  const pluginRoutes = useMemo(() => getRegisteredRoutes(), []);
  const pluginNavItems = useMemo(() => getRegisteredNavItems(), []);
  const route = useMemo(() => resolveAppRoute(location, {
    nodesEnabled: NODES_ENABLED,
    graphEnabled: GRAPH_ENABLED,
    pluginPaths: pluginRoutes.map((item) => item.path),
  }, search), [location, pluginRoutes, search]);
  const {
    path: routePath,
    params: routeParams,
    query: routeQuery,
    activeView,
    detailNode,
    scheduledTaskId,
    mcpApp,
    redirectToCanvas,
  } = route;
  const { openShortcuts, isOverlayOpen } = useAppShell();
  const chatTargetBroker = useChatTargetBroker();
  const activeChatTarget = useActiveChatTarget();
  const [sidebarCollapsed, handleSidebarToggle] = useSidebarCollapsed();
  const [railExpanded, toggleRailExpanded] = useRailExpanded();
  const [settingsWorkspaceId, setSettingsWorkspaceId] = useState<string | null>(null);
  const [workspaceSettingsLoaded, setWorkspaceSettingsLoaded] = useState(false);
  const [selectedNode, setSelectedNode] = useState<KnowledgeNodeSelection | null>(null);
  const [skillsLibraryGlobal, setSkillsLibraryGlobal] = useState(false);
  const [scheduledChatTasks, setScheduledChatTasks] = useState<AgentContextScheduledTaskRef[]>();
  const [nodeDetailBackPath, setNodeDetailBackPath] = useState<string | null>(null);
  const {
    explicitContext: knowledgeChatExplicitContext,
    askAi: handleAskKnowledgeAi,
    removeContext: handleRemoveKnowledgeChatContext,
    consumeComposerRequest: handleKnowledgeComposerRequestHandled,
  } = useKnowledgeAiContext({ openChat: dock.openChat, summarizePrompt: t('workspaceNodes.aiSummarizePrompt') });
  // A task conversation stays with the page it was opened on; any route
  // change returns the dock to the new page's own chat.
  const closeScheduledChatRef = useRef(dock.closeScheduledChat);
  closeScheduledChatRef.current = dock.closeScheduledChat;
  useEffect(() => {
    closeScheduledChatRef.current();
    setScheduledChatTasks(undefined);
  }, [activeView]);
  useEffect(() => {
    void window.canvasWorkspace?.telemetry?.track('page_viewed', { page: telemetryPageName(activeView) });
  }, [activeView]);
  const handleAskAiAboutTask = useCallback((task: ScheduledTask) => {
    setScheduledChatTasks([{ id: task.id, title: task.title }]);
    dock.openChat();
  }, [dock]);
  const handleRemoveChatContext = useCallback((key: string) => {
    if (key.startsWith('task:')) setScheduledChatTasks(undefined);
    else handleRemoveKnowledgeChatContext(key);
  }, [handleRemoveKnowledgeChatContext]);
  const handleSkillsLibraryKindChange = useCallback((kind: 'workspace' | 'global') => {
    setSkillsLibraryGlobal(kind === 'global');
  }, []);
  const knowledgeChatContext = resolveKnowledgeChatRouteContext({
    activeView,
    selectedNode,
    detailNode,
    explicitContext: knowledgeChatExplicitContext ?? undefined,
    skillsLibraryGlobal,
    scheduledTasks: scheduledChatTasks,
  });
  const { openAppSettings, closeAppSettings } = useSettingsNavigation({ location, activeView, setLocation });
  const openWorkspaceSettings = useCallback((workspaceId: string) => {
    setWorkspaceSettingsLoaded(true);
    setSettingsWorkspaceId(workspaceId);
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
    const label = scope.kind === 'workspace'
      ? workspaces.find(workspace => workspace.id === scope.workspaceId)?.name ?? scopeLabel
      : scope.kind === 'global' ? t('chat.scope.global') : scopeLabel;
    enterChatTarget(createChatPageSessionTarget(scope, sessionId, label));
  }, [enterChatTarget, t, workspaces]);
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

  useEffect(() => preloadRoutePages(), []);

  const handlePanelsToggle = usePanelsToggle({
    sidebarCollapsed,
    toggleSidebar: handleSidebarToggle,
    isDockExpanded: dock.isExpanded,
    collapseDock: dock.collapse,
    expandDock: dock.expand,
  });

  useAppShortcutBindings({
    activeView, isOverlayOpen, openShortcuts, toggleSidebar: handleSidebarToggle, togglePanels: handlePanelsToggle,
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
  const hasRunningMcpApps = useGlobalMcpApps().running.length > 0;
  const openMcpApp = useCallback((listing: McpAppEntrypointListing) => {
    globalMcpAppsStore.open(listing);
    setLocation(mcpAppRoutePath(listing));
  }, [setLocation]);
  // The launcher lists workspaces itself, the chat page's session list
  // groups by workspace, and settings has its own category column, so these
  // routes show only the rail. The launcher and settings own the full
  // width, so the dock hides there too (it stays mounted). The workspace
  // tree lives in the wide rail, so the panel only shows canvas Layers.
  const sidebarPanelHidden = sidebarCollapsed
    || activeView !== 'canvas'
    || activeNodes.length === 0;
  const sidebarWidth = (railExpanded ? SIDEBAR_RAIL_EXPANDED_WIDTH : SIDEBAR_RAIL_WIDTH)
    + (sidebarPanelHidden ? 0 : SIDEBAR_PANEL_WIDTH);
  const [sessionListRequest, setSessionListRequest] = useState(0);
  const openAllChats = useCallback(() => {
    enterChatView();
    setSessionListRequest((count) => count + 1);
  }, [enterChatView]);
  useNodeDetailBridges({ activeWorkspaceId: activeId, enabled: NODES_ENABLED, pageNode: detailNode, enterNodePage: dock.enterNodePage, openNodePage, focusNodeOnCanvas });
  return (
    <div className="app">
      <div className="app-body">
        <Sidebar
          collapsed={sidebarPanelHidden}
          onToggle={handleSidebarToggle}
          railExpanded={railExpanded}
          onToggleRail={toggleRailExpanded}
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
          onEnterHome={() => setLocation(ROUTE_HOME)}
          onEnterCanvas={() => setLocation(ROUTE_CANVAS)}
          onEnterNodes={enterNodesView}
          onEnterGraph={enterGraphView}
          onEnterSkills={() => setLocation(ROUTE_PLUGINS)}
          onEnterScheduled={() => setLocation(ROUTE_SCHEDULED)}
          nodesEnabled={NODES_ENABLED}
          graphEnabled={GRAPH_NAV_VISIBLE && GRAPH_ENABLED}
          pluginNavItems={pluginNavItems}
          onNavigate={navigateToPath}
          onExitChat={exitChatView}
          selectedNodeIds={activeSelectedNodeIds}
          activeMcpAppKey={mcpApp ? globalMcpAppKey(mcpApp) : null}
          onOpenMcpApp={openMcpApp}
        />
        <PulseRouter<ActiveView> activeKey={activeView}>
          <PulseRouterView name='canvas' keepAlive>
            <div className="canvas-route">
              {/* Lazy to keep the startup chunk in budget; the placeholder holds the bar's height. */}
              <Suspense fallback={<div className="canvas-route__tabs-placeholder" />}>
                <WorkspaceTabs
                  workspaces={workspaces}
                  activeId={activeId}
                  onSelect={workspaceActions.select}
                  onCreate={() => workspaceActions.select(workspaceActions.create(''))}
                  onOpenLauncher={() => setLocation(ROUTE_HOME)}
                  panelCollapsed={sidebarCollapsed}
                  onTogglePanel={handleSidebarToggle}
                />
              </Suspense>
              {/* The Library drawer and the canvas sit side by side under the tabs. */}
              <div className="canvas-route__body">
                <Workbench
                  activeWorkspaceId={activeId}
                  canvasHostActive={activeView === 'canvas'}
                  workspaces={workspaces}
                  controller={workbench}
                  knowledgeChatContext={knowledgeChatContext}
                  onRemoveKnowledgeChatContext={handleRemoveChatContext}
                  onKnowledgeComposerRequestHandled={handleKnowledgeComposerRequestHandled}
                  onSelectWorkspace={workspaceActions.select}
                  onActivateWorkspace={selectWorkspace}
                  onOpenAppSettings={openAppSettings}
                  onOpenWorkspaceSettings={openWorkspaceSettings}
                  onOpenSessionInScope={openSessionInOwningScope}
                  onSetActiveRootFolder={workspaceActions.setActiveRootFolder}
                />
              </div>
            </div>
          </PulseRouterView>
          <PulseRouterView name="chat">
            <Suspense fallback={null}>
              <ChatRoute
                allWorkspaces={workspaces}
                openScheduledTaskId={routeParams.get('scheduledTask')}
                sessionListRequest={sessionListRequest}
                initialTarget={chatEntryTarget}
                getWorkspaceNodes={getWorkspaceNodes}
                getWorkspaceRootFolder={getWorkspaceRootFolder}
                onWorkspaceContextRequest={ensureWorkspaceNodesLoaded}
                onWorkspaceScopeChange={reportChatWorkspace}
                onExit={exitChatView}
                onNodeFocus={focusNodeOnCanvas}
                onOpenAppSettings={openAppSettings}
              />
            </Suspense>
          </PulseRouterView>
          <NodesRouteViews enabled={NODES_ENABLED} workspaces={workspaces} detailNode={detailNode} onBack={exitNodeDetailView} onAskAi={handleAskKnowledgeAi} onAskAiAboutDetail={dock.openChat} onOpenGraph={GRAPH_ENABLED ? enterGraphView : undefined} />
          {GRAPH_ENABLED && (
            <PulseRouterView name="graph">
              <GraphPage workspaces={workspaces} selectedNode={selectedNode} onSelectNode={setSelectedNode} onOpenList={NODES_ENABLED ? enterNodesView : undefined} />
            </PulseRouterView>
          )}
          <SkillsRouteView activeWorkspaceId={activeId} workspaces={workspaces}
            onSelectWorkspace={(workspaceId) => { ensureWorkspaceNodesLoaded(workspaceId); selectWorkspace(workspaceId); }}
            onNavigatePlugins={() => setLocation(ROUTE_PLUGINS)}
            onLibraryKindChange={handleSkillsLibraryKindChange} />
          <PulseRouterView name="plugins"><PluginMarketRouteView onNavigateSkills={() => setLocation(ROUTE_SKILLS)} onOpenSettings={() => openAppSettings('plugins')} /></PulseRouterView>
          <HomeRouteView
            active={activeView === 'home'}
            onOpenModelSettings={() => openAppSettings('models')}
            workspaces={workspaces}
            folders={folders}
            loadedNodes={workbench.allNodes}
            onWorkspaceContextRequest={ensureWorkspaceNodesLoaded}
            onEnterChat={enterChatTarget}
            onOpenSession={openSessionInOwningScope}
            onOpenAllChats={openAllChats}
            onOpenWorkspace={workspaceActions.select}
            onCreateWorkspace={(name, folderId) => workspaceActions.select(workspaceActions.create(name, folderId))}
            onOpenAllWorkspaces={railExpanded ? undefined : toggleRailExpanded}
          />
          <SettingsRouteView section={(routeParams.get('section') ?? 'models') as SettingsSection} onClose={closeAppSettings} />
          <ScheduledRouteViews scheduledTaskId={scheduledTaskId}
            onExitScheduledTask={() => setLocation(ROUTE_SCHEDULED)} onOpenAppSettings={openAppSettings}
            onAskAiAboutTask={handleAskAiAboutTask} />
          <PulseRouterView name={MCP_APP_VIEW} keepAlive>
            {(mcpApp || hasRunningMcpApps) && (
              <Suspense fallback={null}>
                <GlobalMcpAppsView active={mcpApp} onCloseActive={() => setLocation(ROUTE_CANVAS)} />
              </Suspense>
            )}
          </PulseRouterView>
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
      <RightDock
        readingLeftInset={sidebarWidth}
        hostView={activeView}
        hidden={activeView === 'home' || activeView === 'settings'}
        workspaces={workspaces}
        activeWorkspaceId={dockWorkspaceId}
        activeIdReady={activeIdReady}
        chatTabEnabled={isDockChatTabEnabled(activeView)}
        canvasTabEditingAllowed={isCanvasTabEditingAllowed(activeView)}
        onCanvasNodesChange={handleNodesChange}
        onCanvasSelectionChange={handleSelectionChange}
        reserveSpace
        capWidth={activeView !== 'canvas'}
        pageMinAppWidth={sidebarWidth + 440}
        onOpenNodePage={openNodePage}
        onActivateWorkspace={activateDockWorkspace}
      />
      <ConversationCompletionToastBridge onOpenSessionInScope={openSessionInOwningScope} />
      <Suspense fallback={null}><TelemetryNoticeBridge /></Suspense>
      <Suspense fallback={null}><MigrationSpinner /></Suspense>
      <DeferredSettings
        workspaceLoaded={workspaceSettingsLoaded}
        workspaceId={settingsWorkspaceId}
        workspaces={workspaces}
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
      <ChatTargetProvider>
        <RightDockProvider><AppContent /></RightDockProvider>
      </ChatTargetProvider>
    </AppShellProvider>
  </I18nProvider>
);
export default App;
