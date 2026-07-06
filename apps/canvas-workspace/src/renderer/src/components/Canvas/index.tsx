import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import { useCanvas } from '../../hooks/useCanvas';
import { useNodes } from '../../hooks/useNodes';
import { useNodeDrag } from '../../hooks/useNodeDrag';
import { useNodeResize } from '../../hooks/useNodeResize';
import { useCanvasContext } from '../../hooks/useCanvasContext';
import { useCanvasFit } from '../../hooks/useCanvasFit';
import { useCanvasKeyboard } from '../../hooks/useCanvasKeyboard';
import { useCanvasSearch } from '../../hooks/useCanvasSearch';
import { useCanvasImagePaste } from '../../hooks/useCanvasImagePaste';
import { useTemporaryHandTool } from '../../hooks/useTemporaryHandTool';
import { useEdgeInteraction } from '../../hooks/useEdgeInteraction';
import { useShapeDraw } from '../../hooks/useShapeDraw';
import { useMarqueeSelect } from '../../hooks/useMarqueeSelect';
import { useCanvasFocusMode } from './hooks/useCanvasFocusMode';
import { useCanvasSelection } from './hooks/useCanvasSelection';
import { useCanvasContextMenu } from './hooks/useCanvasContextMenu';
import { useCanvasNodeActions } from './hooks/useCanvasNodeActions';
import { useCanvasSyncEffects } from './hooks/useCanvasSyncEffects';
import { useCanvasMouseHandlers } from './hooks/useCanvasMouseHandlers';
import { useCanvasPaletteCommands } from './hooks/useCanvasPaletteCommands';
import { useCanvasEdgeHandlers } from './hooks/useCanvasEdgeHandlers';
import { useCanvasRenderOrder } from './hooks/useCanvasRenderOrder';
import { useCanvasReferenceActions } from './hooks/useCanvasReferenceActions';
import { useCanvasExternalNodeEvents } from './hooks/useCanvasExternalNodeEvents';
import { useCanvasVisibility } from './hooks/useCanvasVisibility';
import { useCanvasDemoCanvas } from './hooks/useCanvasDemoCanvas';
import { CanvasRootView } from './CanvasRootView';
import { useAppShell } from '../AppShellProvider';
import { useI18n } from '../../i18n';
import { getNodeDefaultSize } from '../../utils/nodeFactory';
import { CANVAS_NODE_TYPE_LABEL_KEY } from '../../utils/nodeTypeI18n';
import { getUrlHostname, normalizeReferenceUrl } from '../ReferenceDrawer/utils';
import type { AgentNodeData, CanvasNode, IframeNodeData } from '../../types';
import type { CanvasProps } from './types';
import { EXPERIMENTAL_FLAG_AGENT_TEAMS } from '../../../../shared/experimental-features';
import { WorkspaceActiveProvider } from '../../hooks/useWorkspaceActive';

const PLUGIN_FLAGS =
  (globalThis as { canvasWorkspace?: { pluginFlags?: Record<string, boolean> } })
    .canvasWorkspace?.pluginFlags ?? {};
const AGENT_TEAMS_ENABLED = PLUGIN_FLAGS[EXPERIMENTAL_FLAG_AGENT_TEAMS] === true;

const isAgentTeamTeammateNode = (node: CanvasNode): boolean => {
  if (node.type !== 'agent') return false;
  const data = node.data as AgentNodeData;
  return !!data.agentTeamId && data.agentTeamRole === 'teammate';
};

export const Canvas = ({
  canvasId,
  canvasName,
  rootFolder,
  isActive = true,
  onNodesChange,
  onSelectionChange,
  focusNodeId,
  onFocusComplete,
  deleteNodeId,
  onDeleteComplete,
  renameRequest,
  onRenameComplete,
  chatPanelOpen, onChatToggle, onChatOpen,
  referenceDrawerOpen,
  onReferenceToggle,
  onPinReferenceNode, onAddToChat, onAddDomSelectionToChat,
  resolveReferenceNode,
  onOpenReferenceSource,
  onUpdateReferenceSource,
  referencePlacementRequest,
  onReferencePlacementComplete,
  createReferenceNode,
  clipboard = null,
  onClipboardChange,
  onPasteReferences,
  nodePatchRequest,
  onNodePatchComplete,
  onOpenAppSettings,
  onSetRootFolder,
}: CanvasProps) => {
  const { confirm, notify, updateToast, dismissToast, openShortcuts, isOverlayOpen } = useAppShell();
  const { t } = useI18n();

  // Persistent save-failure toast with a Retry action. Repeated failures
  // replace the previous toast instead of stacking; flushSave is assigned
  // to the ref after useNodes returns it below.
  const flushSaveRef = useRef<() => void>(() => undefined);
  const saveErrorToastIdRef = useRef<string | null>(null);
  const handleSaveError = useCallback(() => {
    if (saveErrorToastIdRef.current) dismissToast(saveErrorToastIdRef.current);
    saveErrorToastIdRef.current = notify({
      tone: 'error',
      title: t('canvas.saveFailed'),
      description: t('canvas.saveFailedDescription'),
      autoCloseMs: 0,
      action: {
        label: t('canvas.saveRetry'),
        onClick: () => {
          saveErrorToastIdRef.current = null;
          flushSaveRef.current();
        },
      },
    });
  }, [dismissToast, notify, t]);
  const [activeTool, setActiveTool] = useState('select');
  const [searchOpen, setSearchOpen] = useState(false);
  const keyboardLocked = !isActive || isOverlayOpen;
  const temporaryHandTool = useTemporaryHandTool(!keyboardLocked);
  const effectiveActiveTool = temporaryHandTool ? 'hand' : activeTool;

  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  const visibleNodesRef = useRef<CanvasNode[]>([]);
  const hasAutoFittedRef = useRef(false);

  const {
    transform, setTransform, moving, panning,
    handleWheel,
    handleMouseDown: canvasMouseDown,
    handleMouseMove: canvasMouseMove,
    handleMouseUp: canvasMouseUp,
    screenToCanvas, resetTransform,
  } = useCanvas(effectiveActiveTool === 'hand');

  const { animating, handleFocusNode, fitAllNodes } = useCanvasFit(containerRef, setTransform);

  /** When the Agent (canvas-cli) creates a node off-screen, show a
   *  toast with a "Jump" action — the existing 2.5s purple
   *  agent-edited ring is enough on its own when the node is already
   *  visible, so we suppress the toast in that case to avoid noise on
   *  bulk creates the user can clearly see. */
  const handleAgentCreated = useCallback(
    (node: CanvasNode) => {
      if (isAgentTeamTeammateNode(node)) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      // Project node center to container-relative screen space. The
      // forward transform mirrors the inverse in useCanvas.screenToCanvas:
      //   screen = canvas * scale + transform
      const screenCenterX =
        (node.x + node.width / 2) * transform.scale + transform.x;
      const screenCenterY =
        (node.y + node.height / 2) * transform.scale + transform.y;
      const inViewport =
        screenCenterX >= 0 &&
        screenCenterX <= rect.width &&
        screenCenterY >= 0 &&
        screenCenterY <= rect.height;
      if (inViewport) return;

      notify({
        tone: 'info',
        title: t('canvas.agentAddedNode', { label: t(CANVAS_NODE_TYPE_LABEL_KEY[node.type]) }),
        description: t('canvas.agentAddedNodeOffscreen'),
        autoCloseMs: 8000,
        action: {
          label: t('canvas.jumpToNode'),
          onClick: () => handleFocusNode(node),
        },
      });
    },
    [transform, notify, handleFocusNode, t],
  );

  const {
    nodes, edges, loaded, externallyEditedIds,
    addNode, updateNode, removeNodes,
    syncDeletedNodes,
    moveNode, moveNodes, resizeNode,
    addEdge, updateEdge, removeEdge,
    setTransformForSave, flushSave, commitHistory,
    undo, redo, duplicateNode, pasteNodes,
    groupNodes, ungroupNodes, wrapNodesInFrame,
  } = useNodes(
    canvasId,
    (savedTransform) => {
      hasAutoFittedRef.current = true;
      setTransform(savedTransform);
    },
    handleAgentCreated,
    handleSaveError,
  );

  useEffect(() => { flushSaveRef.current = flushSave; }, [flushSave]);

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  // React's root wheel listener is passive, so useCanvas.handleWheel cannot
  // suppress Chromium's default ctrl/meta+wheel page zoom (trackpad pinch
  // arrives as ctrl+wheel). Block it with a native non-passive listener;
  // the zoom itself still runs through the synthetic handler.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const blockNativeZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener('wheel', blockNativeZoom, { passive: false });
    return () => el.removeEventListener('wheel', blockNativeZoom);
  }, [loaded]);

  const {
    selectedNodeIds, setSelectedNodeIds,
    selectedEdgeId, setSelectedEdgeId,
    highlightedId, setHighlightedId,
    editingEdgeLabelId, setEditingEdgeLabelId,
    suppressBlankClickRef,
    selectedNodeIdSet,
    handleSelectNode,
    handleMarqueeSelect,
    getAllNodes,
  } = useCanvasSelection({ nodesRef });

  const handleRemoveNodesLocally = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const removed = new Set(ids);
    syncDeletedNodes(ids);
    setSelectedNodeIds((current) => current.filter((id) => !removed.has(id)));
  }, [setSelectedNodeIds, syncDeletedNodes]);

  const { visibleNodes, visibleNodesById, visibleEdges } = useCanvasVisibility({
    nodes, edges, selectedEdgeId, setSelectedEdgeId, setSelectedNodeIds,
  });

  visibleNodesRef.current = visibleNodes;

  const focus = useCanvasFocusMode({
    nodes: visibleNodes, nodesById: visibleNodesById, nodesRef, selectedNodeIds, handleFocusNode,
  });

  const ctxMenu = useCanvasContextMenu({
    containerRef, screenToCanvas, addNode, nodesRef, setSelectedNodeIds,
    setHighlightedId, notify,
  });

  const handleCreateAgentTeam = useCallback(() => {
    const api = window.canvasWorkspace?.agentTeams;
    const container = containerRef.current;
    if (!api || !container) return;
    const rect = container.getBoundingClientRect();
    const center = screenToCanvas(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      container,
    );
    const x = center.x - 560;
    const y = center.y - 310;
    const toastId = notify({
      tone: 'loading',
      title: t('canvas.agentTeamCreating'),
      description: canvasName ?? canvasId,
    });
    void api.create({
      workspaceId: canvasId,
      name: t('canvas.agentTeamName'),
      goal: t('canvas.agentTeamGoal'),
      cwd: rootFolder,
      leadName: t('canvas.agentTeamLeadName'),
      x,
      y,
    }).then((result) => {
      if (!result.ok || !result.snapshot) {
        updateToast(toastId, {
          tone: 'error',
          title: t('canvas.agentTeamCreationFailed'),
          description: result.error ?? t('canvas.agentTeamCreateFailedDescription'),
          autoCloseMs: 4200,
        });
        return;
      }
      const frameNodeId = result.snapshot.frameNodeId;
      if (frameNodeId) {
        setSelectedNodeIds([frameNodeId]);
        setHighlightedId(frameNodeId);
      }
      updateToast(toastId, {
        tone: 'success',
        title: t('canvas.agentTeamCreated'),
        description: t('canvas.agentTeamCreatedDescription'),
        autoCloseMs: 2800,
      });
    }).catch((err) => {
      updateToast(toastId, {
        tone: 'error',
        title: t('canvas.agentTeamCreationFailed'),
        description: err instanceof Error ? err.message : String(err),
        autoCloseMs: 4200,
      });
    });
  }, [
    canvasId,
    canvasName,
    containerRef,
    notify,
    rootFolder,
    screenToCanvas,
    setHighlightedId,
    setSelectedNodeIds,
    t,
    updateToast,
  ]);

  const actions = useCanvasNodeActions({
    nodesRef, edges,
    selectedNodeIds, setSelectedNodeIds,
    selectedEdgeId, setSelectedEdgeId,
    editingEdgeLabelId, setEditingEdgeLabelId,
    canvasId,
    removeNodes, removeEdge,
    syncDeletedNodes,
    groupNodes, ungroupNodes, wrapNodesInFrame,
    notify, confirm,
  });

  useCanvasContext(rootFolder, nodes, canvasName);

  const handleNodeViewportFocus = useCallback((node: CanvasNode) => {
    setSelectedNodeIds([node.id]);
    setHighlightedId(node.id);
    // In focus mode the dedicated reframe effect handles the zoom with
    // tighter padding/maxScale — calling handleFocusNode here too would
    // produce a double reframe at different scales (visible jitter).
    if (!focus.focusModeActive) handleFocusNode(node);
  }, [handleFocusNode, focus.focusModeActive, setSelectedNodeIds, setHighlightedId]);

  const { pasteReferenceNodes } = useCanvasReferenceActions({
    addNode,
    canvasId,
    containerRef,
    createReferenceNode,
    onPasteReferences,
    onReferencePlacementComplete,
    referencePlacementRequest,
    screenToCanvas,
    setSelectedNodeIds,
    updateNode,
  });

  // Keyboard undo/redo with boundary feedback: a no-op Cmd+Z looks like
  // the app froze, so a short toast tells the user the stack is empty.
  const undoWithFeedback = useCallback(() => {
    if (!undo()) {
      notify({ tone: 'info', title: t('canvas.nothingToUndo'), autoCloseMs: 1500 });
    }
  }, [undo, notify, t]);

  const redoWithFeedback = useCallback(() => {
    if (!redo()) {
      notify({ tone: 'info', title: t('canvas.nothingToRedo'), autoCloseMs: 1500 });
    }
  }, [redo, notify, t]);

  // Cross-workspace Cmd+V silently creates *reference* nodes, which can
  // read as a failed paste; a toast makes the reference semantics explicit.
  const pasteReferenceNodesWithFeedback = useCallback((clip: Parameters<typeof pasteReferenceNodes>[0]) => {
    const created = pasteReferenceNodes(clip);
    if (created.length > 0) {
      notify({
        tone: 'info',
        title: t('canvas.pastedReferences', { count: created.length }),
        description: t('canvas.pastedReferencesDescription'),
      });
    }
    return created;
  }, [pasteReferenceNodes, notify, t]);

  const getViewportCenter = useCallback(() => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return screenToCanvas(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      container,
    );
  }, [containerRef, screenToCanvas]);

  const handleCreateUrlNode = useCallback((value: string): CanvasNode | null => {
    const url = normalizeReferenceUrl(value);
    const center = getViewportCenter();
    if (!url || !center) return null;

    const size = getNodeDefaultSize('iframe');
    const node = addNode('iframe', center.x - size.width / 2, center.y - size.height / 2);
    const title = getUrlHostname(url) || url;
    const patch = {
      title,
      data: {
        url,
        html: '',
        mode: 'url',
        prompt: '',
      } satisfies IframeNodeData,
    };
    updateNode(node.id, patch);
    setSelectedNodeIds([node.id]);
    setHighlightedId(node.id);
    return { ...node, ...patch };
  }, [addNode, getViewportCenter, setHighlightedId, setSelectedNodeIds, updateNode]);

  const handleCreateDemoCanvas = useCanvasDemoCanvas({
    addEdge,
    addNode,
    getViewportCenter,
    notify,
    rootFolder,
    setHighlightedId,
    setSelectedNodeIds,
    t,
    updateNode,
  });

  // Zoom-chip companions: reframe around everything / the selection.
  const handleFitAll = useCallback(() => {
    fitAllNodes(visibleNodes);
  }, [fitAllNodes, visibleNodes]);

  const handleFitSelection = useCallback(() => {
    const selected = visibleNodes.filter((n) => selectedNodeIds.includes(n.id));
    if (selected.length > 0) fitAllNodes(selected);
  }, [fitAllNodes, selectedNodeIds, visibleNodes]);

  const handleDuplicateSelection = useCallback(() => {
    if (selectedNodeIds.length === 0) return;
    const created: string[] = [];
    for (const id of selectedNodeIds) {
      const copy = duplicateNode(id);
      if (copy) created.push(copy.id);
    }
    if (created.length > 0) setSelectedNodeIds(created);
  }, [duplicateNode, selectedNodeIds, setSelectedNodeIds]);

  // Ctrl/Cmd+F "find in canvas". Kept separate from the Cmd+K palette
  // because Find is iterative — the bar stays open while the user pages
  // through matches. See useCanvasSearch for details.
  const search = useCanvasSearch({ nodes: visibleNodes });
  const handleSearchMatchActivate = useCallback((node: CanvasNode) => {
    handleNodeViewportFocus(node);
  }, [handleNodeViewportFocus]);

  const {
    draggingId,
    draggingIds,
    dragPreview,
    dragOffset,
    snapLines,
    onDragStart,
    onDragMove,
    onDragEnd,
    onDragCancel,
  } = useNodeDrag(
    moveNode, moveNodes, transform.scale, nodes, selectedNodeIds,
  );
  const { resizingId, resizePreview, onResizeStart, onResizeMove, onResizeEnd, onResizeCancel } =
    useNodeResize(resizeNode, transform.scale, nodes);

  const { sortedNodes, renderGroups } = useCanvasRenderOrder(visibleNodes);

  const getContainer = useCallback(() => containerRef.current, []);

  const {
    state: edgeInteractionState,
    beginConnect, beginMoveEnd, beginMoveBend, beginMoveEdge,
    getPreviewEndpoints,
  } = useEdgeInteraction({
    nodes: visibleNodes, sortedNodes, screenToCanvas, getContainer,
    addEdge, updateEdge, commitHistory, edges: visibleEdges,
    // After the user commits one arrow, hop back to the select tool and
    // auto-select the new edge so the style panel is immediately
    // available. Matches tldraw's "draw one arrow, then edit" flow.
    onConnectCommitted: (edgeId) => {
      setActiveTool('select');
      setSelectedEdgeId(edgeId);
      setSelectedNodeIds([]);
    },
  });

  const edgeHandlers = useCanvasEdgeHandlers({
    beginConnect, beginMoveEnd, beginMoveBend, beginMoveEdge,
    updateEdge,
    setSelectedEdgeId, setSelectedNodeIds, setEditingEdgeLabelId,
  });

  const {
    draft: shapeDraft,
    handleOverlayMouseDown: handleShapeOverlayMouseDown,
    isActive: shapeToolActive,
  } = useShapeDraw({
    activeTool: effectiveActiveTool, screenToCanvas, getContainer, addNode, updateNode,
    // Drop back to the select tool and select the committed shape so
    // the user can immediately restyle it via the ShapeStylePicker.
    onCommitted: (node) => {
      setActiveTool('select');
      setSelectedNodeIds([node.id]);
      setSelectedEdgeId(null);
    },
  });

  const marquee = useMarqueeSelect({
    // Only the plain select tool should own blank-canvas drags. Connect
    // and shape modes mount their own full-canvas overlays that already
    // intercept mousedown.
    enabled: effectiveActiveTool === 'select' && !shapeToolActive,
    screenToCanvas, getContainer, nodes: visibleNodes,
    onSelect: handleMarqueeSelect,
  });

  useCanvasKeyboard({
    canvasId,
    undo: undoWithFeedback, redo: redoWithFeedback,
    nodes: visibleNodes, selectedNodeIds, setSelectedNodeIds,
    selectedEdgeId, setSelectedEdgeId, removeEdge: actions.requestRemoveEdge,
    duplicateNode,
    clipboard,
    setClipboard: onClipboardChange ?? (() => undefined),
    pasteNodes,
    pasteReferencedNodes: pasteReferenceNodesWithFeedback,
    groupSelectedNodes: actions.groupSelectedNodes,
    ungroupSelectedNodes: actions.ungroupSelectedNodes,
    removeNodes: actions.requestRemoveNodes,
    moveNodes, commitHistory,
    searchOpen, setSearchOpen,
    findOpen: search.open,
    toggleFindBar: search.toggleBar,
    closeFindBar: search.closeBar,
    findNext: search.next,
    findPrev: search.prev,
    findHasMatches: search.matches.length > 0,
    contextMenu: ctxMenu.contextMenu,
    setContextMenu: ctxMenu.setContextMenu,
    setHighlightedId, handleFocusNode,
    focusModeEnabled: focus.focusModeActive,
    canToggleFocusMode: focus.focusModeAvailable,
    onToggleFocusMode: focus.toggleFocusMode,
    onExitFocusMode: focus.exitFocusMode,
    fullscreenActive: focus.fullscreenNodeId != null,
    onExitFullscreen: focus.exitFullscreen,
    // Hidden canvases stay mounted to preserve their UI state across
    // workspace switches; gate global keyboard shortcuts so only the
    // visible one reacts.
    keyboardLocked,
  });

  useCanvasImagePaste({
    canvasId, active: isActive, containerRef, screenToCanvas,
    addNode, updateNode,
    onCreated: (node) => setSelectedNodeIds([node.id]),
    onPasteUrl: handleCreateUrlNode,
  });

  useCanvasExternalNodeEvents({
    addNode,
    canvasId,
    containerRef,
    screenToCanvas,
    setSelectedNodeIds,
    updateNode,
  });

  const paletteCommands = useCanvasPaletteCommands({
    selectedNodeIds, setSelectedNodeIds, nodesRef: visibleNodesRef,
    duplicateNode, requestRemoveNodes: actions.requestRemoveNodes,
    groupSelectedNodes: actions.groupSelectedNodes,
    ungroupSelectedNodes: actions.ungroupSelectedNodes,
    wrapSelectedNodesInFrame: actions.wrapSelectedNodesInFrame,
    handleToolbarAddNode: ctxMenu.handleToolbarAddNode,
    fitAllNodes, resetTransform,
    chatPanelOpen, onChatToggle,
    referenceDrawerOpen, onReferenceToggle,
    onPinReferenceNode, openShortcuts,
    focusModeActive: focus.focusModeActive,
    focusModeAvailable: focus.focusModeAvailable,
    toggleFocusMode: focus.toggleFocusMode,
  });

  const mouse = useCanvasMouseHandlers({
    canvasId, activeTool: effectiveActiveTool, containerRef, nodesRef,
    suppressBlankClickRef,
    setSelectedNodeIds, setSelectedEdgeId,
    contextMenu: ctxMenu.contextMenu,
    closeContextMenu: ctxMenu.closeContextMenu,
    isBlankCanvasTarget: ctxMenu.isBlankCanvasTarget,
    canvasMouseDown, canvasMouseMove, canvasMouseUp,
    moving, panning,
    onDragStart, onDragMove, onDragEnd,
    onDragCancel, onResizeCancel,
    resizingId, onResizeStart, onResizeMove, onResizeEnd,
    edgeInteractionState, marquee, shapeToolActive, shapeDraft,
    commitHistory, onNodesChange,
  });

  useCanvasSyncEffects({
    canvasId, loaded, nodes, transform, selectedNodeIds,
    autoFitNodes: visibleNodes,
    nodesRef,
    isDraggingRef: mouse.isDraggingRef,
    pendingParentNodesRef: mouse.pendingParentNodesRef,
    hasAutoFittedRef,
    setTransformForSave, flushSave, fitAllNodes,
    setSelectedNodeIds, setHighlightedId,
    handleFocusNode, updateNode,
    handleExternalDelete: actions.handleExternalDelete,
    onNodesChange, onSelectionChange,
    focusNodeId, onFocusComplete,
    deleteNodeId, onDeleteComplete,
    renameRequest, onRenameComplete,
    nodePatchRequest, onNodePatchComplete,
  });

  return (
    <WorkspaceActiveProvider value={isActive}>
    <CanvasRootView
      actions={actions}
      activeTool={effectiveActiveTool}
      animating={animating}
      canvasId={canvasId}
      canvasName={canvasName}
      chatPanelOpen={chatPanelOpen}
      containerRef={containerRef}
      ctxMenu={ctxMenu}
      draggingId={draggingId}
      draggingIds={draggingIds}
      dragPreview={dragPreview}
      dragOffset={dragOffset}
      edgeHandlers={edgeHandlers}
      edgeInteractionState={edgeInteractionState}
      edges={visibleEdges}
      editingEdgeLabelId={editingEdgeLabelId}
      externallyEditedIds={externallyEditedIds}
      findNodesById={visibleNodesById}
      focus={focus}
      getAllNodes={getAllNodes}
      getPreviewEndpoints={getPreviewEndpoints}
      handleNodeViewportFocus={handleNodeViewportFocus}
      handleCreateAgentTeam={AGENT_TEAMS_ENABLED ? handleCreateAgentTeam : undefined}
      handleCreateDemoCanvas={handleCreateDemoCanvas}
      handleCreateUrlNode={handleCreateUrlNode}
      handleSearchMatchActivate={handleSearchMatchActivate}
      handleSelectNode={handleSelectNode}
      handleShapeOverlayMouseDown={handleShapeOverlayMouseDown}
      handleWheel={handleWheel}
      highlightedId={highlightedId}
      loaded={loaded}
      marquee={marquee}
      mouse={mouse}
      moving={moving}
      nodes={visibleNodes}
      nodesById={visibleNodesById}
      onChatOpen={onChatOpen}
      onChatToggle={onChatToggle}
      onFitAll={handleFitAll}
      onFitSelection={handleFitSelection}
      onDuplicateSelection={handleDuplicateSelection}
      onOpenReferenceSource={onOpenReferenceSource}
      onPinReferenceNode={onPinReferenceNode} onAddToChat={onAddToChat} onAddDomSelectionToChat={onAddDomSelectionToChat}
      onReferenceToggle={onReferenceToggle}
      onUpdateReferenceSource={onUpdateReferenceSource}
      onRemoveNodesLocally={handleRemoveNodesLocally}
      openShortcuts={openShortcuts}
      paletteCommands={paletteCommands}
      referenceDrawerOpen={referenceDrawerOpen}
      renderGroups={renderGroups}
      resetTransform={resetTransform}
      resizeNode={resizeNode}
      resizingId={resizingId}
      resizePreview={resizePreview}
      resolveReferenceNode={resolveReferenceNode}
      rootFolder={rootFolder}
      search={search}
      searchOpen={searchOpen}
      selectedEdgeId={selectedEdgeId}
      selectedNodeIdSet={selectedNodeIdSet}
      selectedNodeIds={selectedNodeIds}
      setActiveTool={setActiveTool}
      setSearchOpen={setSearchOpen}
      setSelectedEdgeId={setSelectedEdgeId}
      setSelectedNodeIds={setSelectedNodeIds}
      shapeDraft={shapeDraft}
      shapeToolActive={shapeToolActive}
      snapLines={snapLines}
      transform={transform}
      updateEdge={updateEdge}
      updateNode={updateNode}
      onOpenAppSettings={onOpenAppSettings}
      onSetRootFolder={onSetRootFolder}
    />
    </WorkspaceActiveProvider>
  );
};
