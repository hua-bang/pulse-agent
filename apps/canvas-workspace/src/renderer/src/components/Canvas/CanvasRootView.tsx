import type { CanvasEdge, CanvasNode } from '../../types';
import { CanvasSurface } from './CanvasSurface';
import { CanvasOverlays } from './CanvasOverlays';
import { CanvasFullscreenChip } from './CanvasFullscreenChip';
import type { CanvasProps } from './types';

type CanvasRootViewProps = Pick<
  CanvasProps,
  | 'canvasId'
  | 'canvasName'
  | 'rootFolder'
  | 'chatPanelOpen'
  | 'onChatToggle'
  | 'referenceDrawerOpen'
  | 'onReferenceToggle'
  | 'onPinReferenceNode'
  | 'onAddToChat'
  | 'resolveReferenceNode'
  | 'onOpenReferenceSource'
  | 'onUpdateReferenceSource'
> & {
  actions: any;
  activeTool: string;
  animating: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  ctxMenu: any;
  draggingId: string | null;
  draggingIds: Set<string>;
  edgeHandlers: any;
  edgeInteractionState: any;
  edges: CanvasEdge[];
  editingEdgeLabelId: string | null;
  externallyEditedIds: Set<string>;
  findNodesById: Map<string, CanvasNode>;
  focus: any;
  getAllNodes: () => CanvasNode[];
  getPreviewEndpoints: () => any;
  handleNodeViewportFocus: (node: CanvasNode) => void;
  handleCreateAgentTeam?: () => void;
  handleSearchMatchActivate: (node: CanvasNode) => void;
  handleSelectNode: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  handleShapeOverlayMouseDown: (event: React.MouseEvent) => void;
  handleWheel: (event: React.WheelEvent) => void;
  highlightedId: string | null;
  loaded: boolean;
  marquee: any;
  mouse: any;
  moving: boolean;
  nodes: CanvasNode[];
  nodesById: Map<string, CanvasNode>;
  onFitAll?: () => void;
  onFitSelection?: () => void;
  openShortcuts: () => void;
  paletteCommands: any[];
  referenceDrawerOpen?: boolean;
  renderGroups: {
    containers: CanvasNode[];
    regular: CanvasNode[];
  };
  resetTransform: () => void;
  resizeNode: (id: string, width: number, height: number) => void;
  resizingId: string | null;
  search: ReturnType<typeof import('../../hooks/useCanvasSearch').useCanvasSearch>;
  searchOpen: boolean;
  selectedEdgeId: string | null;
  selectedNodeIdSet: Set<string>;
  selectedNodeIds: string[];
  setActiveTool: (tool: string) => void;
  setSearchOpen: (open: boolean) => void;
  setSelectedEdgeId: (id: string | null) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  shapeDraft: any;
  shapeToolActive: boolean;
  snapLines: any[];
  transform: any;
  updateEdge: (id: string, patch: any) => void;
  updateNode: (id: string, patch: Partial<CanvasNode>) => void;
  onRemoveNodesLocally: (ids: string[]) => void;
};

export const CanvasRootView = ({
  actions,
  activeTool,
  animating,
  canvasId,
  canvasName,
  chatPanelOpen,
  containerRef,
  ctxMenu,
  draggingId,
  draggingIds,
  edgeHandlers,
  edgeInteractionState,
  edges,
  editingEdgeLabelId,
  externallyEditedIds,
  findNodesById,
  focus,
  getAllNodes,
  getPreviewEndpoints,
  handleNodeViewportFocus,
  handleCreateAgentTeam,
  handleSearchMatchActivate,
  handleSelectNode,
  handleShapeOverlayMouseDown,
  handleWheel,
  highlightedId,
  loaded,
  marquee,
  mouse,
  moving,
  nodes,
  nodesById,
  onChatToggle,
  onFitAll,
  onFitSelection,
  onOpenReferenceSource,
  onPinReferenceNode,
  onAddToChat,
  onReferenceToggle,
  onUpdateReferenceSource,
  onRemoveNodesLocally,
  openShortcuts,
  paletteCommands,
  referenceDrawerOpen,
  renderGroups,
  resetTransform,
  resizeNode,
  resizingId,
  resolveReferenceNode,
  rootFolder,
  search,
  searchOpen,
  selectedEdgeId,
  selectedNodeIdSet,
  selectedNodeIds,
  setActiveTool,
  setSearchOpen,
  setSelectedEdgeId,
  setSelectedNodeIds,
  shapeDraft,
  shapeToolActive,
  snapLines,
  transform,
  updateEdge,
  updateNode,
}: CanvasRootViewProps) => {
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
      onWheel={(e) => {
        if (focus.fullscreenNodeId) return;
        handleWheel(e);
      }}
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
        onRemoveNodes={onRemoveNodesLocally}
        onSelect={handleSelectNode}
        onExportMindmapImage={actions.handleExportMindmapImage}
        onFocus={handleNodeViewportFocus}
        onReference={onPinReferenceNode}
        onAddToChat={onAddToChat}
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

      {mouse.interactionShieldActive && <div className="canvas-interaction-shield" aria-hidden="true" />}

      <CanvasOverlays
        nodes={nodes}
        contextMenu={ctxMenu.contextMenu}
        searchOpen={searchOpen}
        activeTool={activeTool}
        scale={transform.scale}
        selectionCount={selectedNodeIds.length}
        onFitAll={onFitAll}
        onFitSelection={onFitSelection}
        chatPanelOpen={chatPanelOpen}
        onChatToggle={onChatToggle}
        referenceDrawerOpen={referenceDrawerOpen}
        onReferenceToggle={onReferenceToggle}
        onCreateNode={ctxMenu.handleCreateNode}
        onCreateAgentTeam={handleCreateAgentTeam}
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
        selectedEdge={edges.find((edge) => edge.id === selectedEdgeId) ?? null}
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
