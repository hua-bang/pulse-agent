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
import { CanvasRootView } from './CanvasRootView';
import { useAppShell } from '../AppShellProvider';
import { NODE_TYPE_LABELS } from '../../utils/nodeFactory';
import type { CanvasNode } from '../../types';
import type { CanvasProps } from './types';

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
  chatPanelOpen,
  onChatToggle,
  referenceDrawerOpen,
  onReferenceToggle,
  onPinReferenceNode,
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
}: CanvasProps) => {
  const { confirm, notify, openShortcuts, isOverlayOpen } = useAppShell();
  const [activeTool, setActiveTool] = useState('select');
  const [searchOpen, setSearchOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const nodesRef = useRef<CanvasNode[]>([]);
  const hasAutoFittedRef = useRef(false);

  const {
    transform, setTransform, moving, panning,
    handleWheel,
    handleMouseDown: canvasMouseDown,
    handleMouseMove: canvasMouseMove,
    handleMouseUp: canvasMouseUp,
    screenToCanvas, resetTransform,
  } = useCanvas(activeTool === 'hand');

  const { animating, handleFocusNode, fitAllNodes } = useCanvasFit(containerRef, setTransform);

  /** When the Agent (canvas-cli) creates a node off-screen, show a
   *  toast with a "Jump" action — the existing 2.5s purple
   *  agent-edited ring is enough on its own when the node is already
   *  visible, so we suppress the toast in that case to avoid noise on
   *  bulk creates the user can clearly see. */
  const handleAgentCreated = useCallback(
    (node: CanvasNode) => {
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
        title: `Agent added a ${NODE_TYPE_LABELS[node.type]}`,
        description: 'Placed outside the current viewport',
        autoCloseMs: 8000,
        action: {
          label: 'Jump',
          onClick: () => handleFocusNode(node),
        },
      });
    },
    [transform, notify, handleFocusNode],
  );

  const {
    nodes, edges, loaded, externallyEditedIds,
    addNode, updateNode, removeNode, removeNodes,
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
  );

  useEffect(() => { nodesRef.current = nodes; }, [nodes]);

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

  // Indexed lookup for O(1) access by id. Declared before the focus
  // memos so they can use it without falling back to O(n)
  // `Array.find`, and reused later for the find-bar's match resolver.
  const nodesById = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const focus = useCanvasFocusMode({
    nodes, nodesById, nodesRef, selectedNodeIds, handleFocusNode,
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
    removeNode, removeNodes, removeEdge,
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

  // Ctrl/Cmd+F "find in canvas". Kept separate from the Cmd+K palette
  // because Find is iterative — the bar stays open while the user pages
  // through matches. See useCanvasSearch for details.
  const search = useCanvasSearch({ nodes });
  const handleSearchMatchActivate = useCallback((node: CanvasNode) => {
    handleNodeViewportFocus(node);
  }, [handleNodeViewportFocus]);

  const { draggingId, draggingIds, snapLines, onDragStart, onDragMove, onDragEnd } = useNodeDrag(
    moveNode, moveNodes, transform.scale, nodes, selectedNodeIds,
  );
  const { resizingId, onResizeStart, onResizeMove, onResizeEnd } =
    useNodeResize(resizeNode, transform.scale);

  const { sortedNodes, renderGroups } = useCanvasRenderOrder(nodes);

  const getContainer = useCallback(() => containerRef.current, []);

  const {
    state: edgeInteractionState,
    beginConnect, beginMoveEnd, beginMoveBend, beginMoveEdge,
    getPreviewEndpoints,
  } = useEdgeInteraction({
    nodes, sortedNodes, screenToCanvas, getContainer,
    addEdge, updateEdge, commitHistory, edges,
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
    activeTool, screenToCanvas, getContainer, addNode, updateNode,
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
    enabled: activeTool === 'select' && !shapeToolActive,
    screenToCanvas, getContainer, nodes,
    onSelect: handleMarqueeSelect,
  });

  useCanvasKeyboard({
    canvasId,
    undo, redo, nodes, selectedNodeIds, setSelectedNodeIds,
    selectedEdgeId, setSelectedEdgeId, removeEdge: actions.requestRemoveEdge,
    duplicateNode,
    clipboard,
    setClipboard: onClipboardChange ?? (() => undefined),
    pasteNodes,
    pasteReferencedNodes: pasteReferenceNodes,
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
    keyboardLocked: !isActive || isOverlayOpen,
  });

  useCanvasImagePaste({
    canvasId, active: isActive, containerRef, screenToCanvas,
    addNode, updateNode,
    onCreated: (node) => setSelectedNodeIds([node.id]),
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
    selectedNodeIds, setSelectedNodeIds, nodesRef,
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
    canvasId, activeTool, containerRef, nodesRef,
    suppressBlankClickRef,
    setSelectedNodeIds, setSelectedEdgeId,
    contextMenu: ctxMenu.contextMenu,
    closeContextMenu: ctxMenu.closeContextMenu,
    isBlankCanvasTarget: ctxMenu.isBlankCanvasTarget,
    canvasMouseDown, canvasMouseMove, canvasMouseUp,
    moving, panning,
    onDragStart, onDragMove, onDragEnd,
    resizingId, onResizeStart, onResizeMove, onResizeEnd,
    edgeInteractionState, marquee, shapeToolActive, shapeDraft,
    commitHistory, onNodesChange,
  });

  useCanvasSyncEffects({
    canvasId, loaded, nodes, transform, selectedNodeIds,
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
    <CanvasRootView
      actions={actions}
      activeTool={activeTool}
      animating={animating}
      canvasId={canvasId}
      canvasName={canvasName}
      chatPanelOpen={chatPanelOpen}
      containerRef={containerRef}
      ctxMenu={ctxMenu}
      draggingId={draggingId}
      draggingIds={draggingIds}
      edgeHandlers={edgeHandlers}
      edgeInteractionState={edgeInteractionState}
      edges={edges}
      editingEdgeLabelId={editingEdgeLabelId}
      externallyEditedIds={externallyEditedIds}
      findNodesById={nodesById}
      focus={focus}
      getAllNodes={getAllNodes}
      getPreviewEndpoints={getPreviewEndpoints}
      handleNodeViewportFocus={handleNodeViewportFocus}
      handleSearchMatchActivate={handleSearchMatchActivate}
      handleSelectNode={handleSelectNode}
      handleShapeOverlayMouseDown={handleShapeOverlayMouseDown}
      handleWheel={handleWheel}
      highlightedId={highlightedId}
      loaded={loaded}
      marquee={marquee}
      mouse={mouse}
      moving={moving}
      nodes={nodes}
      nodesById={nodesById}
      onChatToggle={onChatToggle}
      onOpenReferenceSource={onOpenReferenceSource}
      onPinReferenceNode={onPinReferenceNode}
      onReferenceToggle={onReferenceToggle}
      onUpdateReferenceSource={onUpdateReferenceSource}
      openShortcuts={openShortcuts}
      paletteCommands={paletteCommands}
      referenceDrawerOpen={referenceDrawerOpen}
      renderGroups={renderGroups}
      resetTransform={resetTransform}
      resizeNode={resizeNode}
      resizingId={resizingId}
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
    />
  );
};
