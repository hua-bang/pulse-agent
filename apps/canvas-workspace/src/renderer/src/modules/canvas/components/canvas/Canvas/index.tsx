import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import { useCanvas } from '../../../runtime/useCanvas';
import { useCanvasDocumentHost } from '../../../document/useCanvasDocumentHost';
import { useCanvasContext } from '../../../runtime/useCanvasContext';
import { useCanvasFit } from '../../../runtime/useCanvasFit';
import { useCanvasKeyboard } from '../../../runtime/useCanvasKeyboard';
import { useCanvasSearch } from '../../../runtime/useCanvasSearch';
import { useCanvasImagePaste } from '../../../runtime/useCanvasImagePaste';
import { useTemporaryHandTool } from '../../../runtime/useTemporaryHandTool';
import { useEdgeInteraction } from '../../../runtime/useEdgeInteraction';
import { useShapeDraw } from '../../../runtime/useShapeDraw';
import { useMarqueeSelect } from '../../../runtime/useMarqueeSelect';
import { useCanvasFocusMode } from './hooks/useCanvasFocusMode';
import { useCanvasSelection } from './hooks/useCanvasSelection';
import { useCanvasContextMenu } from './hooks/useCanvasContextMenu';
import { useCanvasNodeActions } from './hooks/useCanvasNodeActions';
import { useCanvasSyncEffects } from './hooks/useCanvasSyncEffects';
import { useCanvasMouseHandlers } from './hooks/useCanvasMouseHandlers';
import { useCanvasPaletteCommands } from './hooks/useCanvasPaletteCommands';
import { useCanvasEdgeHandlers } from './hooks/useCanvasEdgeHandlers';
import { useCanvasNodeGestures } from './hooks/useCanvasNodeGestures';
import { useCanvasReferenceActions } from './hooks/useCanvasReferenceActions';
import { useCanvasExternalNodeEvents } from './hooks/useCanvasExternalNodeEvents';
import { useCanvasVisibility } from './hooks/useCanvasVisibility';
import { useCanvasCreationActions } from './hooks/useCanvasCreationActions';
import { useCanvasFeedbackCommands } from './hooks/useCanvasFeedbackCommands';
import { useNativeCanvasZoomGuard } from './hooks/useNativeCanvasZoomGuard';
import { useCanvasClipboardPaste } from './hooks/useCanvasClipboardPaste';
import { CanvasRootView } from './CanvasRootView';
import { useAppShell } from '../../../../../shared/appShell';
import { useI18n } from '../../../../../i18n';
import type { CanvasNode } from '../../../../../types';
import type { CanvasProps } from './types';
import { EXPERIMENTAL_FLAG_AGENT_TEAMS } from '../../../../../../../shared/experimental-features';
import {
  CanvasKeyboardActiveProvider,
  WorkspaceActiveProvider,
} from '../../../../../shared/workspaceActivity';

const PLUGIN_FLAGS =
  (globalThis as { canvasWorkspace?: { pluginFlags?: Record<string, boolean> } })
    .canvasWorkspace?.pluginFlags ?? {};
const AGENT_TEAMS_ENABLED = PLUGIN_FLAGS[EXPERIMENTAL_FLAG_AGENT_TEAMS] === true;

export const Canvas = ({
  canvasId,
  canvasName,
  rootFolder,
  isActive = true,
  keyboardActive,
  persistViewport = true,
  onNodesChange,
  onEdgesChange,
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
  onPinReferenceNode, onAddToChat, onAddDomSelectionToChat, onSubmitDomReviewComments,
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
  onSetRootFolder,
}: CanvasProps) => {
  const { confirm, notify, updateToast, openShortcuts, isOverlayOpen } = useAppShell();
  const { t } = useI18n();

  const [activeTool, setActiveTool] = useState('select');
  const [searchOpen, setSearchOpen] = useState(false);
  const ownsKeyboard = keyboardActive ?? isActive;
  const keyboardLocked = !ownsKeyboard || isOverlayOpen;
  const temporaryHandTool = useTemporaryHandTool(!keyboardLocked);
  const effectiveActiveTool = temporaryHandTool ? 'hand' : activeTool;

  const containerRef = useRef<HTMLDivElement>(null);
  const transformLayerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  const visibleNodesRef = useRef<CanvasNode[]>([]);

  const {
    transform, setTransform, settledScale, moving, panning,
    handleWheel,
    handleMouseDown: canvasMouseDown,
    handleMouseMove: canvasMouseMove,
    handleMouseUp: canvasMouseUp,
    screenToCanvas, resetTransform, zoomByStep,
  } = useCanvas(effectiveActiveTool === 'hand', transformLayerRef);

  const { animating, handleFocusNode, fitAllNodes } = useCanvasFit(containerRef, setTransform);

  const {
    nodes, edges, loaded, externallyEditedIds,
    addNode, updateNode, removeNodes,
    syncDeletedNodes,
    moveNode, moveNodes, resizeNode,
    addEdge, updateEdge, removeEdge,
    setTransformForSave, flushSave, commitHistory, hasAutoFittedRef,
    undo, redo, duplicateNode, pasteNodes,
    groupNodes, ungroupNodes, wrapNodesInFrame,
    mergeMindmapTopic, splitMindmapTopic,
  } = useCanvasDocumentHost({
    canvasId,
    persistViewport,
    containerRef,
    transform,
    setTransform,
    focusNode: handleFocusNode,
  });

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

  useNativeCanvasZoomGuard(containerRef, loaded);

  const {
    selectedNodeIds, setSelectedNodeIds,
    selectedEdgeId, setSelectedEdgeId,
    highlightedId, setHighlightedId,
    renameSignal, renameNode,
    editingEdgeLabelId, setEditingEdgeLabelId,
    suppressBlankClickRef,
    selectedNodeIdSet,
    handleSelectNode,
    handleMarqueeSelect,
    getAllNodes,
  } = useCanvasSelection({ nodesRef });

  const creation = useCanvasCreationActions({
    surface: { canvasId, canvasName, rootFolder, containerRef, screenToCanvas },
    document: {
      addNode,
      updateNode,
      addEdge,
      mergeMindmapTopic,
      splitMindmapTopic,
      syncDeletedNodes,
    },
    selection: { nodesRef, setSelectedNodeIds, setHighlightedId },
    feedback: { notify, updateToast, t },
  });

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
    setSelectedEdgeId(null);
    setHighlightedId(node.id);
    // In focus mode the dedicated reframe effect handles the zoom with
    // tighter padding/maxScale — calling handleFocusNode here too would
    // produce a double reframe at different scales (visible jitter).
    if (!focus.focusModeActive) handleFocusNode(node);
  }, [handleFocusNode, focus.focusModeActive, setHighlightedId, setSelectedEdgeId, setSelectedNodeIds]);

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
  const feedbackCommands = useCanvasFeedbackCommands({ undo, redo, pasteReferenceNodes });

  /** Keyboard zoom, anchored on the canvas viewport centre. */
  const zoomCanvasBy = useCallback((factor: number) => {
    zoomByStep(factor, containerRef.current);
  }, [zoomByStep]);

  // Zoom-chip companions: reframe around everything / the selection.
  const handleFitAll = useCallback(() => {
    fitAllNodes(visibleNodes);
  }, [fitAllNodes, visibleNodes]);

  // Ctrl/Cmd+F "find in canvas". Kept separate from the Cmd+K palette
  // because Find is iterative — the bar stays open while the user pages
  // through matches. See useCanvasSearch for details.
  const search = useCanvasSearch({ nodes: visibleNodes });
  const handleSearchMatchActivate = useCallback((node: CanvasNode) => {
    handleNodeViewportFocus(node);
  }, [handleNodeViewportFocus]);

  const nodeGestures = useCanvasNodeGestures({
    document: { moveNode, moveNodes, resizeNode },
    nodes,
    visibleNodes,
    selectedNodeIds,
    scale: transform.scale,
  });

  const getContainer = useCallback(() => containerRef.current, []);

  const {
    state: edgeInteractionState,
    beginConnect, beginMoveEnd, beginMoveBend, beginMoveEdge,
    getPreviewEndpoints,
  } = useEdgeInteraction({
    nodes: visibleNodes, sortedNodes: nodeGestures.sortedNodes, screenToCanvas, getContainer,
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
    undo: feedbackCommands.undoWithFeedback, redo: feedbackCommands.redoWithFeedback,
    nodes: visibleNodes, selectedNodeIds, setSelectedNodeIds,
    selectedEdgeId, setSelectedEdgeId, removeEdge: actions.requestRemoveEdge,
    duplicateNode,
    setClipboard: onClipboardChange ?? (() => undefined),
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
    setHighlightedId, handleFocusNode, activeTool, setActiveTool,
    zoomBy: zoomCanvasBy,
    resetZoom: resetTransform,
    fitNodes: fitAllNodes,
    renameNode,
    focusModeEnabled: focus.focusModeActive,
    canToggleFocusMode: focus.focusModeAvailable,
    onToggleFocusMode: focus.toggleFocusMode,
    onExitFocusMode: focus.exitFocusMode,
    onToggleChatPanel: onChatToggle,
    onToggleReferenceDrawer: onReferenceToggle,
    fullscreenActive: focus.fullscreenNodeId != null,
    onExitFullscreen: focus.exitFullscreen,
    // Hidden canvases stay mounted to preserve their UI state across
    // workspace switches; gate global keyboard shortcuts so only the
    // visible one reacts.
    keyboardLocked,
  });

  const pasteClipboardNodes = useCanvasClipboardPaste({
    canvasId, clipboard, pasteNodes,
    pasteReferenceNodes: feedbackCommands.pasteReferencesWithFeedback,
    setSelectedNodeIds,
  });

  useCanvasImagePaste({
    canvasId, active: ownsKeyboard, containerRef, screenToCanvas,
    addNode, updateNode,
    onCreated: (node) => setSelectedNodeIds([node.id]),
    onPasteUrl: creation.createUrlNode,
    pasteCanvasNodes: pasteClipboardNodes,
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
    canvasId, activeTool: effectiveActiveTool, containerRef,
    suppressBlankClickRef,
    setSelectedNodeIds, setSelectedEdgeId,
    contextMenu: ctxMenu.contextMenu,
    closeContextMenu: ctxMenu.closeContextMenu,
    isBlankCanvasTarget: ctxMenu.isBlankCanvasTarget,
    canvasMouseDown, canvasMouseMove, canvasMouseUp,
    moving, panning,
    onDragStart: nodeGestures.onDragStart,
    onDragMove: nodeGestures.onDragMove,
    onDragEnd: nodeGestures.onDragEnd,
    onDragCancel: nodeGestures.onDragCancel,
    onResizeCancel: nodeGestures.onResizeCancel,
    resizingId: nodeGestures.resizingId,
    onResizeStart: nodeGestures.onResizeStart,
    onResizeMove: nodeGestures.onResizeMove,
    onResizeEnd: nodeGestures.onResizeEnd,
    edgeInteractionState, marquee, shapeToolActive, shapeDraft,
    commitHistory, onNodesChange,
  });

  useCanvasSyncEffects({
    canvasId, loaded, nodes, edges, transform, selectedNodeIds,
    moving,
    persistViewport,
    autoFitNodes: visibleNodes,
    nodesRef,
    isDraggingRef: mouse.isDraggingRef,
    pendingParentNodesRef: mouse.pendingParentNodesRef,
    hasAutoFittedRef,
    setTransformForSave, flushSave, fitAllNodes,
    handleNodeViewportFocus, updateNode,
    handleExternalDelete: actions.handleExternalDelete,
    onNodesChange, onEdgesChange, onSelectionChange,
    focusNodeId, onFocusComplete,
    deleteNodeId, onDeleteComplete,
    renameRequest, onRenameComplete,
    nodePatchRequest, onNodePatchComplete,
  });

  return (
    <WorkspaceActiveProvider value={isActive}>
    <CanvasKeyboardActiveProvider value={ownsKeyboard}>
    <CanvasRootView
      actions={actions}
      activeTool={effectiveActiveTool}
      animating={animating}
      canvasId={canvasId}
      canvasName={canvasName}
      chatPanelOpen={chatPanelOpen}
      containerRef={containerRef}
      ctxMenu={ctxMenu}
      nodeGestures={nodeGestures}
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
      handleCreateAgentTeam={AGENT_TEAMS_ENABLED ? creation.createAgentTeam : undefined}
      handleCreateDemoCanvas={creation.createDemoCanvas}
      handleSearchMatchActivate={handleSearchMatchActivate}
      handleSelectNode={handleSelectNode}
      handleShapeOverlayMouseDown={handleShapeOverlayMouseDown}
      handleWheel={handleWheel}
      highlightedId={highlightedId}
      renameSignal={renameSignal}
      loaded={loaded}
      marquee={marquee}
      mouse={mouse}
      moving={moving}
      nodes={visibleNodes}
      nodesById={visibleNodesById}
      onChatOpen={onChatOpen}
      onChatToggle={onChatToggle}
      onFitAll={handleFitAll}
      onOpenReferenceSource={onOpenReferenceSource}
      onPinReferenceNode={onPinReferenceNode} onAddToChat={onAddToChat} onAddDomSelectionToChat={onAddDomSelectionToChat} onSubmitDomReviewComments={onSubmitDomReviewComments}
      onReferenceToggle={onReferenceToggle}
      onUpdateReferenceSource={onUpdateReferenceSource}
      onRemoveNodesLocally={creation.removeNodesLocally}
      onMergeMindmapTopic={creation.mergeMindmap}
      onSplitMindmapTopic={creation.splitMindmap}
      openShortcuts={openShortcuts}
      paletteCommands={paletteCommands}
      referenceDrawerOpen={referenceDrawerOpen}
      resetTransform={resetTransform}
      resizeNode={resizeNode}
      resolveReferenceNode={resolveReferenceNode}
      rootFolder={rootFolder}
      search={search}
      searchOpen={searchOpen}
      selectedEdgeId={selectedEdgeId}
      selectedNodeIdSet={selectedNodeIdSet}
      selectedNodeIds={selectedNodeIds}
      settledScale={settledScale}
      setActiveTool={setActiveTool}
      setSearchOpen={setSearchOpen}
      setSelectedEdgeId={setSelectedEdgeId}
      setSelectedNodeIds={setSelectedNodeIds}
      shapeDraft={shapeDraft}
      shapeToolActive={shapeToolActive}
      transform={transform}
      transformLayerRef={transformLayerRef}
      updateEdge={updateEdge}
      updateNode={updateNode}
      onSetRootFolder={onSetRootFolder}
    />
    </CanvasKeyboardActiveProvider>
    </WorkspaceActiveProvider>
  );
};
