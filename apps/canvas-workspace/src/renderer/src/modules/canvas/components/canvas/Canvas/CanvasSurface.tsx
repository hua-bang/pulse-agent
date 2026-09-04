import type React from 'react';
import { useMemo } from 'react';
import type { CanvasNode } from '../../../../../types';
import { markOnce } from '../../../../../perf/monitor';
import { OVERVIEW_SCALE_THRESHOLD } from '../../../runtime/useCanvas';
import {
  applyNodeResizePreview,
  applyResizePreviewToNodes,
} from '../../../runtime/useNodeResize';
import { CanvasAlignmentGuides } from '../CanvasAlignmentGuides';
import { CanvasEdgesLayer } from '../CanvasEdgesLayer';
import { CanvasNodeView } from '../CanvasNodeView';
import type { CanvasNodeRenderMode } from '../CanvasNodeView/types';
import { CanvasGestureHud, MarqueePreview, ShapeDraftPreview } from './CanvasGestureOverlays';
import type { CanvasSurfaceProps } from './CanvasSurface.types';

const FIT_TRANSITION =
  'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94), --canvas-scale 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
const SETTLE_TRANSITION = '--canvas-scale 140ms ease-out';

/**
 * The `.canvas-transform` CSS `transition` for the current
 * animating/moving combination. Extracted as a pure function (rather than
 * inlined in the JSX style object) so the timing-sensitive regimes below
 * have a direct unit-test surface:
 *  1. `animating && !moving` — a fit/focus call (useCanvasFit) is easing
 *     transform+scale toward a target. The `!moving` guard matters:
 *     without it, starting a wheel gesture within the 380ms fit-animation
 *     window kept this transition active, so every subsequent wheel tick
 *     re-eased from wherever the CSS interpolation currently sat instead
 *     of jumping straight to the new value — a rubber-band lag chasing
 *     the pointer. Gesturing cuts the transition immediately; the canvas
 *     snaps to the fit's current value and the gesture takes over clean.
 *  2. `moving` (mid-gesture, not animating) — no transition: transform
 *     must track the pointer/wheel with zero lag.
 *  3. otherwise (a gesture just settled, or fully idle) — glide
 *     `--canvas-scale` only (never `transform`, which isn't changing
 *     here) instead of snapping. Scale-compensated content (terminal
 *     glyphs via the ResizeObserver in TerminalNodeBody/
 *     useAgentNodeController, frame headers, node chrome) eases back to
 *     true size instead of popping the instant the gesture ends.
 */
export const getCanvasTransformTransition = (animating: boolean, moving: boolean): string | undefined => {
  if (animating && !moving) return FIT_TRANSITION;
  if (moving) return undefined;
  return SETTLE_TRANSITION;
};
/**
 * The class list for the current gesture/scale state. The overview class is
 * settledScale-driven, so it flips once per gesture at settle — see the
 * OVERVIEW_SCALE_THRESHOLD doc in useCanvas for why mid-gesture flipping
 * measured worse.
 */
export const getCanvasTransformClassName = (
  moving: boolean,
  animating: boolean,
  settledScale: number,
): string =>
  `canvas-transform${moving || animating ? ' canvas-transform--moving' : ''}` +
  `${settledScale < 0.6 ? ' canvas-transform--small' : ''}` +
  `${settledScale < OVERVIEW_SCALE_THRESHOLD ? ' canvas-transform--overview' : ''}`;


export const CanvasSurface = ({
  transform,
  transformLayerRef,
  settledScale,
  animating,
  moving,
  renderGroups,
  nodes,
  edges,
  rootFolder,
  canvasId,
  canvasName,
  draggingId,
  draggingIds,
  dragPreview,
  dragOffset,
  resizingId,
  resizePreview,
  selectedNodeIdSet,
  selectedEdgeId,
  highlightedId,
  renameSignal,
  externallyEditedIds,
  edgeInteractionState,
  edgePreviewEndpoints,
  shapeDraft,
  marqueeRect,
  snapLines,
  focusedNodeIds,
  focusContextNodeIds,
  focusModeEnabled = false,
  readOnly = false,
  onDragStart,
  onResizeStart,
  onUpdate,
  onAutoResize,
  onRemove,
  onRemoveNodes,
  onExportMindmapImage,
  onMergeMindmapTopic,
  onSplitMindmapTopic,
  onSelect,
  onFocus,
  onReference,
  onAddToChat,
  onAddToCanvas,
  onAddDomSelectionToChat,
  onSubmitDomReviewComments,
  resolveReferenceNode,
  onOpenReferenceSource,
  onUpdateReferenceSource,
  onUngroupSelectedGroups,
  fullscreenNodeId = null,
  onToggleFullscreen,
  onExitFullscreen,
  onSelectEdge,
  onEdgeHandleMouseDown,
  onEdgeBodyMouseDown,
  onEdgeBodyDoubleClick,
  onEdgeBodyContextMenu,
  getAllNodes,
}: CanvasSurfaceProps) => {
  // Startup metric: first canvas render (idempotent, Map lookup after that).
  markOnce('canvas:first-render');
  const edgeNodes = useMemo(
    () => applyResizePreviewToNodes(nodes, resizePreview),
    [nodes, resizePreview],
  );
  const renderNode = (node: CanvasNode, renderMode: CanvasNodeRenderMode = 'full') => {
    const nodeIsDragging = draggingIds.has(node.id) || draggingId === node.id;
    const renderedNode = applyNodeResizePreview(node, resizePreview);
    return (
    <CanvasNodeView
      key={`${node.id}:${renderMode}`}
      node={renderedNode}
      getAllNodes={getAllNodes}
      rootFolder={rootFolder}
      workspaceId={canvasId}
      workspaceName={canvasName}
      isDragging={nodeIsDragging}
      dragOffset={nodeIsDragging ? dragOffset : null}
      isResizing={resizingId === node.id}
      isSelected={selectedNodeIdSet.has(node.id)}
      isHighlighted={highlightedId === node.id}
      renameToken={renameSignal?.nodeId === node.id ? renameSignal.token : 0}
      isAgentEdited={externallyEditedIds.has(node.id)}
      focusState={!focusModeEnabled
        ? 'neutral'
        : focusedNodeIds?.has(node.id) ? 'focused'
          : focusContextNodeIds?.has(node.id) ? 'context'
            : 'dimmed'}
      onDragStart={onDragStart}
      onResizeStart={onResizeStart}
      onUpdate={onUpdate}
      onAutoResize={onAutoResize}
      onRemove={onRemove}
      onRemoveNodes={onRemoveNodes}
      onExportMindmapImage={onExportMindmapImage}
      onMergeMindmapTopic={onMergeMindmapTopic}
      onSplitMindmapTopic={onSplitMindmapTopic}
      onSelect={onSelect}
      onFocus={onFocus}
      onReference={onReference}
      onAddToChat={onAddToChat}
      onAddToCanvas={onAddToCanvas}
      onAddDomSelectionToChat={onAddDomSelectionToChat}
      onSubmitDomReviewComments={onSubmitDomReviewComments}
      resolveReferenceNode={resolveReferenceNode}
      onOpenReferenceSource={onOpenReferenceSource}
      onUpdateReferenceSource={onUpdateReferenceSource}
      onUngroupSelectedGroups={onUngroupSelectedGroups}
      isFullscreen={fullscreenNodeId === node.id}
      onToggleFullscreen={onToggleFullscreen}
      readOnly={readOnly}
      renderMode={renderMode}
    />
    );
  };

  return (
    <div
      ref={transformLayerRef}
      className={getCanvasTransformClassName(moving, animating, settledScale)}
      style={{
        transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
        '--canvas-scale': settledScale,
        transition: getCanvasTransformTransition(animating, moving),
      } as React.CSSProperties}
    >
      {/* Focus-mode backdrop: a giant translucent dark rectangle that
          lives INSIDE the transform so it scales/pans with the canvas
          and we never have to fight `.canvas-transform`'s stacking
          context. Sized large enough to cover any reasonable zoom/pan
          combination so the user never sees its edge. Without this, the
          per-node dim opacity competes with a bright white canvas
          background and the focused node fails to pop. */}
      {focusModeEnabled && <div className="canvas-focus-backdrop" />}
      {/* Fullscreen backdrop. Sits between the other (now offset-jumped)
          nodes and the fullscreen node, dimming everything behind. Click
          anywhere on the backdrop to exit. */}
      {fullscreenNodeId && (
        <div
          className="canvas-fullscreen-backdrop"
          onMouseDown={(e) => {
            e.stopPropagation();
            onExitFullscreen?.();
          }}
        />
      )}
      {/* Containers render first as the canvas background/grouping layer. Edges
          render after containers so frame fills can no longer cover connection
          lines, while regular nodes still paint above edges. */}
      {renderGroups.containers.map((node) => (
        renderNode(node, node.type === 'frame' ? 'frame-body' : 'full')
      ))}
      <CanvasEdgesLayer
        edges={edges}
        nodes={edgeNodes}
        selectedEdgeId={selectedEdgeId}
        onSelectEdge={onSelectEdge}
        interactionState={edgeInteractionState}
        previewEndpoints={edgePreviewEndpoints}
        focusedNodeIds={focusedNodeIds}
        focusContextNodeIds={focusContextNodeIds}
        focusModeEnabled={focusModeEnabled}
        onHandleMouseDown={onEdgeHandleMouseDown}
        onBodyMouseDown={onEdgeBodyMouseDown}
        onBodyDoubleClick={onEdgeBodyDoubleClick}
        onBodyContextMenu={onEdgeBodyContextMenu}
      />
      {renderGroups.regular.map((node) => renderNode(node))}
      {!fullscreenNodeId && renderGroups.containers
        .filter((node) => node.type === 'frame')
        .map((node) => renderNode(node, 'frame-title'))}
      {shapeDraft && <ShapeDraftPreview draft={shapeDraft} scale={transform.scale} />}
      {marqueeRect && <MarqueePreview rect={marqueeRect} scale={transform.scale} />}
      {snapLines && snapLines.length > 0 && (
        <CanvasAlignmentGuides lines={snapLines} scale={transform.scale} />
      )}
      {(dragPreview || resizePreview) && (
        <CanvasGestureHud
          dragPreview={dragPreview}
          resizePreview={resizePreview}
          scale={transform.scale}
        />
      )}
    </div>
  );
};
