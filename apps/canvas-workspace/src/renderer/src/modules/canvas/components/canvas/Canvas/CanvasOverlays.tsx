import React, { lazy, Suspense, useMemo } from 'react';
import type { CanvasEdge, CanvasNode, CanvasTransform } from '../../../../../types';
import { ChatFloatingButton } from '../../../../chat/floating';
import type { EdgeInteractionState } from '../../../runtime/useEdgeInteraction';
import { applyEdgeInteractionPreview } from '../CanvasEdgesLayer';
import { CanvasEmptyHint } from '../CanvasEmptyHint';
import { EdgeLabel } from '../EdgeLabel';
import { FloatingToolbar } from '../FloatingToolbar';
import { NodeContextMenu } from '../NodeContextMenu';
import { ZoomIndicator } from '../ZoomIndicator';
import { useI18n } from '../../../../../i18n';
import type { CanvasOverlaysProps } from './CanvasOverlays.types';

const CommandPalette = lazy(() =>
  import('../CommandPalette').then((module) => ({ default: module.CommandPalette })),
);
const SearchBar = lazy(() =>
  import('../SearchBar').then((module) => ({ default: module.SearchBar })),
);
const EdgeStylePanel = lazy(() =>
  import('../EdgeStylePanel').then((module) => ({ default: module.EdgeStylePanel })),
);

export const projectEdgeOverlayGeometry = (
  edges: CanvasEdge[] | undefined,
  selectedEdge: CanvasEdge | null | undefined,
  interactionState: EdgeInteractionState | null | undefined,
): { edges: CanvasEdge[] | undefined; selectedEdge: CanvasEdge | null | undefined } => {
  let changed = false;
  const projected = edges?.map((edge) => {
    const next = applyEdgeInteractionPreview(edge, interactionState);
    if (next !== edge) changed = true;
    return next;
  });
  const renderedEdges = changed ? projected : edges;
  const renderedSelectedEdge = selectedEdge
    ? renderedEdges?.find((edge) => edge.id === selectedEdge.id)
      ?? applyEdgeInteractionPreview(selectedEdge, interactionState)
    : selectedEdge;
  return { edges: renderedEdges, selectedEdge: renderedSelectedEdge };
};

export const shouldRenderEdgeLabels = ({
  moving,
  editingEdgeLabelId,
}: {
  moving: boolean;
  editingEdgeLabelId?: string | null;
}): boolean => !moving || editingEdgeLabelId != null;

export const shouldRenderEdgeStylePanel = (moving: boolean): boolean => !moving;

export const CanvasOverlays = ({
  nodes,
  contextMenu,
  searchOpen,
  activeTool,
  moving = false,
  scale,
  onFitAll,
  chatPanelOpen,
  onChatToggle,
  referenceDrawerOpen,
  onReferenceToggle,
  onCreateNode,
  onCreateDemo,
  onCreateAgentTeam,
  onCloseContextMenu,
  onOpenShortcuts,
  onSetRootFolder,
  onToolChange,
  onAddNode,
  onResetTransform,
  paletteCommands,
  onSearchSelect,
  onCloseSearch,
  findSearch,
  findNodesById,
  onFindMatchActivate,
  onConnectMouseDown,
  shapeToolActive,
  onShapeMouseDown,
  selectedEdge,
  edgeInteractionState,
  transform,
  onUpdateEdge,
  onRemoveEdge,
  edges,
  editingEdgeLabelId,
  onStartEditEdgeLabel,
  onCommitEditEdgeLabel,
  onCancelEditEdgeLabel,
}: CanvasOverlaysProps) => {
  const { t } = useI18n();
  const renderEdgeLabels = shouldRenderEdgeLabels({ moving, editingEdgeLabelId });
  const renderEdgeStylePanel = shouldRenderEdgeStylePanel(moving);
  const overlayEdges = useMemo(
    () => projectEdgeOverlayGeometry(edges, selectedEdge, edgeInteractionState),
    [edgeInteractionState, edges, selectedEdge],
  );

  return (
    <>
      {nodes.length === 0 && !contextMenu && (
        <CanvasEmptyHint
          onCreateNode={(type) => onAddNode(type)}
          onCreateDemo={onCreateDemo}
          onOpenShortcuts={onOpenShortcuts}
          onSetRootFolder={onSetRootFolder}
        />
      )}

      {contextMenu && (
        <NodeContextMenu
          x={contextMenu.screenX}
          y={contextMenu.screenY}
          onCreate={onCreateNode}
          onClose={onCloseContextMenu}
        />
      )}

      {/* Full-canvas overlay active only in Connect mode. It intercepts
        pointer events above nodes so mousedown on any location — node
        or blank — begins an edge draft instead of a node drag. The
        FloatingToolbar renders AFTER this element and has its own
        position/z-index, so mode switching still works while this is
        mounted. */}
      {activeTool === 'connect' && (
        <div
          className="canvas-connect-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            cursor: 'crosshair',
            // Slightly below the zero-indexed floating toolbar
            // (`.floating-toolbar` has its own z-index for chrome) but
            // above nodes inside `.canvas-transform`.
            zIndex: 5,
          }}
          onMouseDown={onConnectMouseDown}
        />
      )}

      {/* Drag-to-draw overlay for shape tools. Same layering trick as the
        connect overlay so a drag that starts over an existing node still
        creates a shape rather than selecting the node underneath. */}
      {shapeToolActive && (
        <div
          className="canvas-shape-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            cursor: 'crosshair',
            zIndex: 5,
          }}
          onMouseDown={onShapeMouseDown}
        />
      )}

      {renderEdgeStylePanel && overlayEdges.selectedEdge && onUpdateEdge && onRemoveEdge && (
        <Suspense fallback={null}>
          <EdgeStylePanel
            edge={overlayEdges.selectedEdge}
            nodes={nodes}
            transform={transform}
            onUpdate={onUpdateEdge}
            onRemove={onRemoveEdge}
          />
        </Suspense>
      )}

      {/* Edge labels. Rendered for every edge that either carries a
        non-empty label or is currently in edit mode. The edit-mode check
        lets us open the input on a freshly-dbl-clicked unlabeled edge
        without first persisting an empty string. */}
      {renderEdgeLabels && overlayEdges.edges && onStartEditEdgeLabel && onCommitEditEdgeLabel && onCancelEditEdgeLabel &&
        overlayEdges.edges
          .filter((edge) => (edge.label && edge.label.length > 0) || editingEdgeLabelId === edge.id)
          .map((edge) => (
            <EdgeLabel
              key={edge.id}
              edge={edge}
              nodes={nodes}
              transform={transform}
              isEditing={editingEdgeLabelId === edge.id}
              onStartEdit={onStartEditEdgeLabel}
              onCommit={onCommitEditEdgeLabel}
              onCancel={onCancelEditEdgeLabel}
            />
          ))}

      <div
        className={[
          'canvas-bottom-chrome',
          moving ? 'canvas-bottom-chrome--moving' : '',
        ].filter(Boolean).join(' ')}
      >
        {/* Selection toolbar hidden for now (product call on 2026-07-27);
          selection-related props above stay wired for a future re-enable. */}
        <FloatingToolbar
          activeTool={activeTool}
          onToolChange={onToolChange}
          onAddNode={onAddNode}
          onCreateAgentTeam={onCreateAgentTeam}
          referenceDrawerOpen={referenceDrawerOpen}
          onReferenceToggle={onReferenceToggle}
        />
        <div className="canvas-bottom-chrome__left">
          <ZoomIndicator
            scale={scale}
            onReset={onResetTransform}
            onFitAll={onFitAll}
          />
        </div>
        <div className="canvas-bottom-chrome__right">
          {onChatToggle && (
            <ChatFloatingButton
              active={chatPanelOpen}
              onClick={onChatToggle}
              title={t('canvas.toolbar.toggleChat')}
              ariaLabel={t('canvas.toolbar.toggleChat')}
            />
          )}
        </div>
      </div>

      {searchOpen && (
        <Suspense fallback={null}>
          <CommandPalette
            nodes={nodes}
            commands={paletteCommands}
            onSelectNode={onSearchSelect}
            onClose={onCloseSearch}
          />
        </Suspense>
      )}

      {findSearch.open && (
        <Suspense fallback={null}>
          <SearchBar
            search={findSearch}
            nodesById={findNodesById}
            onActivateMatch={onFindMatchActivate}
          />
        </Suspense>
      )}
    </>
  );
};
