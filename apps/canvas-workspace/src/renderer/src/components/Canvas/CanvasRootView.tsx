import { useCallback, useState } from 'react';
import type { CanvasEdge, CanvasNode } from '../../types';
import { CanvasSurface } from './CanvasSurface';
import { CanvasOverlays } from './CanvasOverlays';
import { CanvasFullscreenChip } from './CanvasFullscreenChip';
import { EdgeContextMenu } from '../EdgeContextMenu';
import type { CanvasProps } from './types';
import type { NodeDragOffset, NodeDragPreview } from '../../hooks/useNodeDrag';
import type { NodeResizePreview } from '../../hooks/useNodeResize';

type CanvasRootViewProps = Pick<
  CanvasProps,
  | 'canvasId'
  | 'canvasName'
  | 'rootFolder'
  | 'chatPanelOpen'
  | 'onChatToggle'
  | 'onChatOpen'
  | 'referenceDrawerOpen'
  | 'onReferenceToggle'
  | 'onPinReferenceNode'
  | 'onAddToChat'
  | 'onAddDomSelectionToChat'
  | 'resolveReferenceNode'
  | 'onOpenReferenceSource'
  | 'onUpdateReferenceSource'
  | 'onOpenAppSettings'
  | 'onSetRootFolder'
> & {
  actions: any;
  activeTool: string;
  animating: boolean;
  containerRef: React.RefObject<HTMLDivElement>;
  ctxMenu: any;
  draggingId: string | null;
  draggingIds: Set<string>;
  dragPreview: NodeDragPreview | null;
  dragOffset: NodeDragOffset | null;
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
  handleCreateDemoCanvas?: () => void;
  handleCreateUrlNode?: (url: string) => void;
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
  onDuplicateSelection?: () => void;
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
  resizePreview: NodeResizePreview | null;
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
  onChatOpen,
  containerRef,
  ctxMenu,
  draggingId,
  draggingIds,
  dragPreview,
  dragOffset,
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
  handleCreateDemoCanvas,
  handleCreateUrlNode,
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
  onDuplicateSelection,
  onOpenReferenceSource,
  onPinReferenceNode,
  onAddToChat,
  onAddDomSelectionToChat,
  onReferenceToggle,
  onUpdateReferenceSource,
  onOpenAppSettings,
  onSetRootFolder,
  onRemoveNodesLocally,
  openShortcuts,
  paletteCommands,
  referenceDrawerOpen,
  renderGroups,
  resetTransform,
  resizeNode,
  resizingId,
  resizePreview,
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
  // Right-click menu on a connection. Selecting the edge first keeps the
  // style panel / Delete-key behavior consistent with the menu actions.
  const [edgeMenu, setEdgeMenu] = useState<{ edgeId: string; x: number; y: number } | null>(null);
  const handleEdgeContextMenu = useCallback((edgeId: string, e: React.MouseEvent) => {
    setSelectedEdgeId(edgeId);
    setSelectedNodeIds([]);
    setEdgeMenu({ edgeId, x: e.clientX, y: e.clientY });
  }, [setSelectedEdgeId, setSelectedNodeIds]);

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
        dragPreview={dragPreview}
        dragOffset={dragOffset}
        resizingId={resizingId}
        resizePreview={resizePreview}
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
        onAddDomSelectionToChat={onAddDomSelectionToChat}
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
        onEdgeBodyContextMenu={handleEdgeContextMenu}
        onExitFullscreen={focus.exitFullscreen}
        getAllNodes={getAllNodes}
      />

      {edgeMenu && (
        <EdgeContextMenu
          x={edgeMenu.x}
          y={edgeMenu.y}
          edgeId={edgeMenu.edgeId}
          onEditLabel={(id) => edgeHandlers.handleEdgeBodyDoubleClick(id)}
          onEditStyle={(id) => {
            setSelectedEdgeId(id);
            setSelectedNodeIds([]);
          }}
          onDelete={(id) => { void actions.requestRemoveEdge(id); }}
          onClose={() => setEdgeMenu(null)}
        />
      )}

      {focus.fullscreenNodeId && (
        <CanvasFullscreenChip
          referenceDrawerOpen={referenceDrawerOpen}
          onReferenceToggle={onReferenceToggle}
          chatPanelOpen={chatPanelOpen}
          onChatOpen={onChatOpen}
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
        onFitAll={onFitAll}
        chatPanelOpen={chatPanelOpen}
        onChatToggle={onChatToggle}
        referenceDrawerOpen={referenceDrawerOpen}
        onReferenceToggle={onReferenceToggle}
        onCreateNode={ctxMenu.handleCreateNode}
        onCreateUrl={handleCreateUrlNode}
        onCreateDemo={handleCreateDemoCanvas}
        onCreateAgentTeam={handleCreateAgentTeam}
        onCloseContextMenu={ctxMenu.closeContextMenu}
        onOpenShortcuts={openShortcuts}
        onConfigureAi={() => onOpenAppSettings?.('models')}
        onSetRootFolder={onSetRootFolder}
        onToolChange={setActiveTool}
        onAddNode={ctxMenu.handleToolbarAddNode}
        onResetTransform={resetTransform}
        paletteCommands={paletteCommands}
        onSearchSelect={handleNodeViewportFocus}
        onCloseSearch={() => setSearchOpen(false)}
        selectedNodeIds={selectedNodeIds}
        onFitSelection={onFitSelection}
        onDuplicateSelection={onDuplicateSelection}
        onGroupSelection={actions.groupSelectedNodes}
        onWrapSelectionInFrame={actions.wrapSelectedNodesInFrame}
        onPinReferenceSelection={onPinReferenceNode && selectedNodeIds.length === 1
          ? () => {
              const [nodeId] = selectedNodeIds;
              if (nodeId) onPinReferenceNode(nodeId);
            }
          : undefined}
        onAddSelectionToChat={onAddToChat && selectedNodeIds.length === 1
          ? () => {
              const [nodeId] = selectedNodeIds;
              if (nodeId) onAddToChat(nodeId);
            }
          : undefined}
        onDeleteSelection={() => { void actions.requestRemoveNodes(selectedNodeIds); }}
        focusModeActive={focus.focusModeActive}
        focusModeAvailable={focus.focusModeAvailable}
        onToggleFocusMode={focus.toggleFocusMode}
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
      />
    </div>
  );
};
