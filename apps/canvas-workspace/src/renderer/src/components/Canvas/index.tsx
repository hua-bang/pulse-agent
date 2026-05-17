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
import { useAppShell } from '../AppShellProvider';
import { NODE_TYPE_LABELS } from '../../utils/nodeFactory';
import type { CanvasNode } from '../../types';
import type { CanvasNodeRenameRequest } from '../../types/ui-interaction';
import { CanvasSurface } from './CanvasSurface';
import { CanvasOverlays } from './CanvasOverlays';
import { CanvasFullscreenChip } from './CanvasFullscreenChip';

interface CanvasProps {
  canvasId: string;
  canvasName?: string;
  rootFolder?: string;
  onNodesChange?: (canvasId: string, nodes: CanvasNode[]) => void;
  onSelectionChange?: (canvasId: string, selectedNodeIds: string[]) => void;
  focusNodeId?: string;
  onFocusComplete?: () => void;
  deleteNodeId?: string;
  onDeleteComplete?: () => void;
  renameRequest?: CanvasNodeRenameRequest;
  onRenameComplete?: () => void;
  chatPanelOpen?: boolean;
  onChatToggle?: () => void;
  referenceDrawerOpen?: boolean;
  onReferenceToggle?: () => void;
  onPinReferenceNode?: (nodeId: string) => void;
}

export const Canvas = ({
  canvasId,
  canvasName,
  rootFolder,
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
    clipboardNodes, setClipboardNodes,
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
    undo, redo, nodes, selectedNodeIds, setSelectedNodeIds,
    selectedEdgeId, setSelectedEdgeId, removeEdge: actions.requestRemoveEdge,
    duplicateNode, clipboardNodes, setClipboardNodes, pasteNodes,
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
    keyboardLocked: isOverlayOpen,
  });

  useCanvasImagePaste({
    canvasId, active: true, containerRef, screenToCanvas,
    addNode, updateNode,
    onCreated: (node) => setSelectedNodeIds([node.id]),
  });

  // External entry point for "add this URL as an iframe node" — currently
  // dispatched by the LinkDrawer when the user clicks "加入当前画布".
  // Listening on `window` keeps the drawer fully decoupled from canvas
  // internals; the workspace match avoids cross-canvas pollution.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { workspaceId?: string; url?: string }
        | undefined;
      if (!detail?.url || detail.workspaceId !== canvasId) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const center = screenToCanvas(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        container,
      );
      // Default iframe node is 520×400; offset by half so the new node
      // lands centered on the visible viewport.
      const node = addNode("iframe", center.x - 260, center.y - 200);
      let title = node.title;
      try {
        title = new URL(detail.url).host || title;
      } catch {
        // Leave default title if URL is malformed.
      }
      updateNode(node.id, {
        title,
        data: { url: detail.url, html: "", mode: "url", prompt: "" },
      });
      setSelectedNodeIds([node.id]);
    };
    window.addEventListener("canvas:add-iframe-from-url", handler);
    return () => {
      window.removeEventListener("canvas:add-iframe-from-url", handler);
    };
  }, [canvasId, addNode, updateNode, screenToCanvas, setSelectedNodeIds]);

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
  });

  if (!loaded) {
    return (
      <div className="canvas-container">
        <div className="canvas-empty-hint">
          <div className="hint-text">Loading workspace...</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`canvas-container${mouse.cursorClass}${mouse.iframeShieldClass}`}
      onWheel={handleWheel}
      onMouseDown={mouse.handleRootMouseDown}
      onMouseMove={mouse.handleMouseMove}
      onMouseUp={mouse.handleMouseUp}
      onMouseLeave={() => {
        if (!mouse.isDraggingRef.current && !mouse.isEdgeDragging()) mouse.handleMouseUp();
      }}
      onDragStart={(e) => e.preventDefault()}
      onDoubleClick={ctxMenu.handleDoubleClick}
      onContextMenu={ctxMenu.handleContextMenu}
      onClick={mouse.handleCanvasClick}
      data-focus-mode={focus.focusModeActive ? 'on' : undefined}
      data-fullscreen={focus.fullscreenNodeId ? 'on' : undefined}
    >
      <div className="canvas-grid" />

      <CanvasSurface
        transform={transform}
        animating={animating}
        moving={moving}
        renderGroups={renderGroups}
        nodes={nodes}
        edges={edges}
        rootFolder={rootFolder}
        canvasId={canvasId}
        canvasName={canvasName}
        draggingId={draggingId}
        draggingIds={draggingIds}
        resizingId={resizingId}
        selectedNodeIdSet={selectedNodeIdSet}
        selectedEdgeId={selectedEdgeId}
        highlightedId={highlightedId}
        externallyEditedIds={externallyEditedIds}
        edgeInteractionState={edgeInteractionState}
        edgePreviewEndpoints={getPreviewEndpoints()}
        shapeDraft={shapeDraft}
        marqueeRect={marquee.rect}
        snapLines={snapLines}
        focusedNodeIds={focus.focusedNodeIds}
        focusContextNodeIds={focus.focusContextNodeIds}
        focusModeEnabled={focus.focusModeActive}
        onDragStart={mouse.handleSurfaceDragStart}
        onResizeStart={mouse.handleSurfaceResizeStart}
        onUpdate={updateNode}
        onAutoResize={resizeNode}
        onRemove={actions.handleRemoveNode}
        onSelect={handleSelectNode}
        onExportMindmapImage={actions.handleExportMindmapImage}
        onFocus={handleNodeViewportFocus}
        onReference={onPinReferenceNode}
        onUngroupSelectedGroups={actions.ungroupSelectedNodes}
        fullscreenNodeId={focus.fullscreenNodeId}
        onToggleFullscreen={focus.handleToggleFullscreen}
        onSelectEdge={(id) => {
          setSelectedEdgeId(id);
          if (id) setSelectedNodeIds([]);
        }}
        onEdgeHandleMouseDown={edgeHandlers.handleEdgeHandleMouseDown}
        onEdgeBodyMouseDown={edgeHandlers.handleEdgeBodyMouseDown}
        onEdgeBodyDoubleClick={edgeHandlers.handleEdgeBodyDoubleClick}
        onExitFullscreen={focus.exitFullscreen}
        getAllNodes={getAllNodes}
      />

      {focus.fullscreenNodeId && (
        <CanvasFullscreenChip
          referenceDrawerOpen={referenceDrawerOpen}
          onReferenceToggle={onReferenceToggle}
          chatPanelOpen={chatPanelOpen}
          onChatToggle={onChatToggle}
          onExitFullscreen={focus.exitFullscreen}
        />
      )}

      <CanvasOverlays
        nodes={nodes}
        contextMenu={ctxMenu.contextMenu}
        searchOpen={searchOpen}
        activeTool={activeTool}
        scale={transform.scale}
        selectionCount={selectedNodeIds.length}
        chatPanelOpen={chatPanelOpen}
        onChatToggle={onChatToggle}
        referenceDrawerOpen={referenceDrawerOpen}
        onReferenceToggle={onReferenceToggle}
        onCreateNode={ctxMenu.handleCreateNode}
        onCloseContextMenu={ctxMenu.closeContextMenu}
        onOpenShortcuts={openShortcuts}
        onToolChange={setActiveTool}
        onAddNode={ctxMenu.handleToolbarAddNode}
        onResetTransform={resetTransform}
        paletteCommands={paletteCommands}
        onSearchSelect={handleNodeViewportFocus}
        onCloseSearch={() => setSearchOpen(false)}
        findSearch={search}
        findNodesById={nodesById}
        onFindMatchActivate={handleSearchMatchActivate}
        onConnectMouseDown={edgeHandlers.handleConnectOverlayMouseDown}
        shapeToolActive={shapeToolActive}
        onShapeMouseDown={handleShapeOverlayMouseDown}
        selectedEdge={edges.find((e) => e.id === selectedEdgeId) ?? null}
        transform={transform}
        onUpdateEdge={(id, patch) => updateEdge(id, patch)}
        onRemoveEdge={(id) => { void actions.requestRemoveEdge(id); }}
        edges={edges}
        editingEdgeLabelId={editingEdgeLabelId}
        onStartEditEdgeLabel={edgeHandlers.handleEdgeBodyDoubleClick}
        onCommitEditEdgeLabel={edgeHandlers.handleCommitEditEdgeLabel}
        onCancelEditEdgeLabel={edgeHandlers.handleCancelEditEdgeLabel}
        focusModeEnabled={focus.focusModeActive}
      />
    </div>
  );
};
