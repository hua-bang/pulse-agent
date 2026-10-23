import { lazy, Suspense, useCallback, useState } from 'react';
import { CanvasSurface } from './CanvasSurface';
import { CanvasOverlays } from './CanvasOverlays';
import { CanvasFullscreenChip } from './CanvasFullscreenChip';
import { EdgeContextMenu } from '../EdgeContextMenu';
import { findNodeAtPoint, NodeActionsMenu } from '../NodeActionsMenu';
import { useChatDeliveryNotifier } from '../../../../chat/delivery';
import type { CanvasRootViewProps } from './CanvasRootView.types';

// Loaded on the first single selection, so it stays out of the startup bundle.
const NodeAskBar = lazy(() => import('../NodeAskBar')
  .then((module) => ({ default: module.NodeAskBar })));

export const CanvasRootView = ({
  actions,
  activeTool,
  animating,
  canvasId,
  canvasName,
  chatPanelOpen,
  onChatOpen,
  containerRef,
  ctxMenu,
  nodeGestures,
  drawingGestures,
  edges,
  editingEdgeLabelId,
  externallyEditedIds,
  findNodesById,
  focus,
  getAllNodes,
  handleNodeViewportFocus,
  handleCreateAgentTeam,
  handleCreateDemoCanvas,
  canvasReferenceWorkspaces,
  handleCreateCanvasReference,
  handleSearchMatchActivate,
  handleSelectNode,
  handleWheel,
  highlightedId,
  renameSignal,
  loaded,
  mouse,
  moving,
  nodes,
  nodesById,
  onChatToggle,
  onFitAll,
  onOpenReferenceSource,
  onPinReferenceNode,
  onAddToChat,
  onAddDomSelectionToChat,
  onSubmitDomReviewComments,
  onAskAboutNodes,
  onReferenceToggle,
  onUpdateReferenceSource,
  onSetRootFolder,
  onRemoveNodesLocally,
  openShortcuts,
  paletteCommands,
  referenceDrawerOpen,
  resetTransform,
  resizeNode,
  resolveReferenceNode,
  rootFolder,
  settledScale,
  search,
  searchOpen,
  selectedEdgeId,
  selectedNodeIdSet,
  selectedNodeIds,
  setActiveTool,
  setSearchOpen,
  setSelectedEdgeId,
  setSelectedNodeIds,
  transform,
  transformLayerRef,
  updateEdge,
  updateNode,
  onMergeMindmapTopic,
  onSplitMindmapTopic,
}: CanvasRootViewProps) => {
  // Right-click menu on a connection. Selecting the edge first keeps the
  // style panel / Delete-key behavior consistent with the menu actions.
  const [edgeMenu, setEdgeMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const handleEdgeContextMenu = useCallback((edgeId: string, e: React.MouseEvent) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeIds([]);
    setEdgeMenu({ edgeId, x: e.clientX, y: e.clientY });
  }, [setSelectedEdgeId, setSelectedNodeIds]);

  // Right-click menu on a node. A node outside the selection becomes the
  // selection first, so the menu acts on what the user pointed at. A
  // focused editor keeps its own right-click (text selection, spelling).
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number } | null>(null);
  const handleRootContextMenu = (e: React.MouseEvent) => {
    const target = e.target;
    const container = containerRef.current;
    const editing = target instanceof HTMLElement
      && document.activeElement instanceof HTMLElement
      && document.activeElement.isContentEditable
      && document.activeElement.contains(target);
    if (!(target instanceof HTMLElement) || !target.closest('.canvas-node') || editing || !container) {
      ctxMenu.handleContextMenu(e);
      return;
    }
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const node = findNodeAtPoint(nodes, {
      x: (e.clientX - rect.left - transform.x) / transform.scale,
      y: (e.clientY - rect.top - transform.y) / transform.scale,
    });
    if (!node) return;
    if (!selectedNodeIds.includes(node.id)) setSelectedNodeIds([node.id]);
    setSelectedEdgeId(null);
    setNodeMenu({ x: e.clientX, y: e.clientY });
  };

  // The ask bar only follows one settled selection in select mode, so it
  // never fights a gesture, a menu, or a fullscreen node.
  const gestureActive = Boolean(nodeGestures.draggingId)
    || nodeGestures.draggingIds.size > 0
    || Boolean(nodeGestures.resizingId);
  const askNode = onAskAboutNodes
    && selectedNodeIds.length === 1
    && activeTool === 'select'
    && !moving
    && !gestureActive
    && !focus.fullscreenNodeId
    && !ctxMenu.contextMenu
    && !nodeMenu
    ? nodesById.get(selectedNodeIds[0])
    : undefined;

  // In fullscreen the chip's chat button brings the node along as context,
  // reporting delivery the same way the node header's chat button does.
  const notifyChatDelivery = useChatDeliveryNotifier();
  const fullscreenNodeId = focus.fullscreenNodeId;
  const addFullscreenNodeToChat = onAddToChat && fullscreenNodeId
    ? async () => {
      const title = nodesById.get(fullscreenNodeId)?.title;
      try {
        const receipt = await onAddToChat(fullscreenNodeId);
        if (receipt) notifyChatDelivery(receipt, title);
      } catch (error) {
        notifyChatDelivery({
          status: 'failed',
          target: null,
          error: error instanceof Error ? error.message : String(error),
        }, title);
      }
    }
    : undefined;

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
      onMouseMove={(e) => {
        mouse.handleMouseMove(e);
        drawingGestures.connectHandles.handleMouseMove(e);
      }}
      onMouseUp={mouse.handleMouseUp}
      onMouseLeave={() => {
        drawingGestures.connectHandles.handleMouseLeave();
        if (!mouse.isDraggingRef.current && !mouse.isEdgeDragging()) mouse.handleMouseUp();
      }}
      onDragStart={(e) => e.preventDefault()}
      onDoubleClick={ctxMenu.handleDoubleClick}
      onContextMenu={handleRootContextMenu}
      onClick={mouse.handleCanvasClick}
      data-canvas-id={canvasId}
      data-focus-mode={focus.focusModeActive ? 'on' : undefined}
      data-fullscreen={focus.fullscreenNodeId ? 'on' : undefined}
      data-moving={moving ? 'on' : undefined}
    >
      <div className="canvas-grid" />

      <CanvasSurface
        transform={transform}
        settledScale={settledScale}
        transformLayerRef={transformLayerRef}
        animating={animating}
        moving={moving}
        renderGroups={nodeGestures.renderGroups}
        nodes={nodes}
        edges={edges}
        rootFolder={rootFolder}
        canvasId={canvasId}
        canvasName={canvasName}
        draggingId={nodeGestures.draggingId}
        draggingIds={nodeGestures.draggingIds}
        dragPreview={nodeGestures.dragPreview}
        dragOffset={nodeGestures.dragOffset}
        resizingId={nodeGestures.resizingId}
        resizePreview={nodeGestures.resizePreview}
        selectedNodeIdSet={selectedNodeIdSet}
        selectedEdgeId={selectedEdgeId}
        highlightedId={highlightedId}
        renameSignal={renameSignal}
        externallyEditedIds={externallyEditedIds}
        edgeInteractionState={drawingGestures.edgeInteractionState}
        edgePreview={drawingGestures.edgePreview}
        connectHandleNodeId={drawingGestures.connectHandles.hoverNodeId}
        onConnectHandleMouseDown={drawingGestures.connectHandles.beginFromHandle}
        shapeDraft={drawingGestures.shapeDraft}
        marqueeRect={drawingGestures.marquee.rect}
        snapLines={nodeGestures.snapLines}
        focusedNodeIds={focus.focusedNodeIds}
        focusContextNodeIds={focus.focusContextNodeIds}
        focusModeEnabled={focus.focusModeActive}
        onDragStart={mouse.handleSurfaceDragStart}
        onResizeStart={mouse.handleSurfaceResizeStart}
        onUpdate={updateNode}
        onAutoResize={resizeNode}
        onRemove={actions.handleRemoveNode}
        onRemoveNodes={onRemoveNodesLocally}
        onSelect={handleSelectNode}
        onExportMindmapImage={actions.handleExportMindmapImage}
        onMergeMindmapTopic={onMergeMindmapTopic}
        onSplitMindmapTopic={onSplitMindmapTopic}
        onFocus={handleNodeViewportFocus}
        onReference={onPinReferenceNode}
        onAddToChat={onAddToChat}
        onAddDomSelectionToChat={onAddDomSelectionToChat}
        onSubmitDomReviewComments={onSubmitDomReviewComments}
        resolveReferenceNode={resolveReferenceNode}
        onOpenReferenceSource={onOpenReferenceSource}
        onUpdateReferenceSource={onUpdateReferenceSource}
        onUngroupSelectedGroups={actions.ungroupSelectedNodes}
        fullscreenNodeId={focus.fullscreenNodeId}
        onToggleFullscreen={focus.handleToggleFullscreen}
        onSelectEdge={(id) => {
          setSelectedEdgeId(id);
          if (id) setSelectedNodeIds([]);
        }}
        onEdgeHandleMouseDown={drawingGestures.edgeHandlers.handleEdgeHandleMouseDown}
        onEdgeBodyMouseDown={drawingGestures.edgeHandlers.handleEdgeBodyMouseDown}
        onEdgeBodyDoubleClick={drawingGestures.edgeHandlers.handleEdgeBodyDoubleClick}
        onEdgeBodyContextMenu={handleEdgeContextMenu}
        onExitFullscreen={focus.exitFullscreen}
        getAllNodes={getAllNodes}
      />

      {edgeMenu && (
        <EdgeContextMenu
          x={edgeMenu.x}
          y={edgeMenu.y}
          edgeId={edgeMenu.edgeId}
          onEditLabel={(id) => drawingGestures.edgeHandlers.handleEdgeBodyDoubleClick(id)}
          onEditStyle={(id) => {
            setSelectedEdgeId(id);
            setSelectedNodeIds([]);
          }}
          onDelete={(id) => { void actions.requestRemoveEdge(id); }}
          onClose={() => setEdgeMenu(null)}
        />
      )}

      {nodeMenu && (
        <NodeActionsMenu
          x={nodeMenu.x}
          y={nodeMenu.y}
          commands={paletteCommands}
          onClose={() => setNodeMenu(null)}
        />
      )}

      {focus.fullscreenNodeId && (
        <CanvasFullscreenChip
          referenceDrawerOpen={referenceDrawerOpen}
          onReferenceToggle={onReferenceToggle}
          chatPanelOpen={chatPanelOpen}
          onChatOpen={addFullscreenNodeToChat ?? onChatOpen}
          onExitFullscreen={focus.exitFullscreen}
        />
      )}

      {mouse.interactionShieldActive && (
        <div
          className={`canvas-interaction-shield${mouse.motionShieldOnly ? ' canvas-interaction-shield--canvas-motion' : ''}`}
          aria-hidden="true"
        />
      )}

      <CanvasOverlays
        nodes={nodes}
        edgeInteractionState={drawingGestures.edgeInteractionState}
        contextMenu={ctxMenu.contextMenu}
        searchOpen={searchOpen}
        activeTool={activeTool}
        moving={moving}
        scale={moving ? settledScale : transform.scale}
        onFitAll={onFitAll}
        chatPanelOpen={chatPanelOpen}
        onChatToggle={onChatToggle}
        referenceDrawerOpen={referenceDrawerOpen}
        onReferenceToggle={onReferenceToggle}
        onCreateNode={ctxMenu.handleCreateNode}
        canvasReferenceWorkspaces={canvasReferenceWorkspaces}
        onCreateCanvasReference={handleCreateCanvasReference}
        workspaceId={canvasId}
        onCreateDemo={handleCreateDemoCanvas}
        onCreateAgentTeam={handleCreateAgentTeam}
        onCloseContextMenu={ctxMenu.closeContextMenu}
        onOpenShortcuts={openShortcuts}
        onSetRootFolder={onSetRootFolder}
        onToolChange={setActiveTool}
        onAddNode={ctxMenu.handleToolbarAddNode}
        onResetTransform={resetTransform}
        paletteCommands={paletteCommands}
        onSearchSelect={handleNodeViewportFocus}
        onCloseSearch={() => setSearchOpen(false)}
        findSearch={search}
        findNodesById={nodesById}
        onFindMatchActivate={handleSearchMatchActivate}
        onConnectMouseDown={drawingGestures.edgeHandlers.handleConnectOverlayMouseDown}
        shapeToolActive={drawingGestures.shapeToolActive}
        onShapeMouseDown={drawingGestures.handleShapeOverlayMouseDown}
        selectedEdge={edges.find((edge) => edge.id === selectedEdgeId) ?? null}
        transform={transform}
        onUpdateEdge={(id, patch) => updateEdge(id, patch)}
        onRemoveEdge={(id) => { void actions.requestRemoveEdge(id); }}
        edges={edges}
        editingEdgeLabelId={editingEdgeLabelId}
        onStartEditEdgeLabel={drawingGestures.edgeHandlers.handleEdgeBodyDoubleClick}
        onCommitEditEdgeLabel={drawingGestures.edgeHandlers.handleCommitEditEdgeLabel}
        onCancelEditEdgeLabel={drawingGestures.edgeHandlers.handleCancelEditEdgeLabel}
      />

      {askNode && onAskAboutNodes && (
        <Suspense fallback={null}>
          <NodeAskBar node={askNode} transform={transform} onAsk={onAskAboutNodes} />
        </Suspense>
      )}
    </div>
  );
};
