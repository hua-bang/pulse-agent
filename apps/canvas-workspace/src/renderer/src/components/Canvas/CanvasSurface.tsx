import type React from 'react';
import { useMemo, type RefObject } from 'react';
import type { AgentContextDomReviewComment, AgentContextDomSelectionRef, CanvasEdge, CanvasNode } from '../../types';
import { CanvasNodeView } from '../CanvasNodeView';
import { CanvasEdgesLayer } from '../CanvasEdgesLayer';
import { CanvasAlignmentGuides } from '../CanvasAlignmentGuides';
import {
  applyNodeResizePreview,
  applyResizePreviewToNodes,
  type NodeResizePreview,
  type ResizeEdge,
} from '../../hooks/useNodeResize';
import type { NodeDragOffset, NodeDragPreview } from '../../hooks/useNodeDrag';
import type { EdgeInteractionState, Point } from '../../hooks/useEdgeInteraction';
import type { ShapeDraft } from '../../hooks/useShapeDraw';
import type { MarqueeRect } from '../../hooks/useMarqueeSelect';
import type { SnapLine } from '../../utils/canvasSnapping';
import { ShapePrimitive } from '../../utils/shapeGeometry';
import { useI18n } from '../../i18n';
import type { CanvasNodeRenderMode } from '../CanvasNodeView/types';
import { markOnce } from '../../perf/monitor';

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
 * Below this settled scale, `.canvas-transform--overview` lets CSS swap live
 * inline iframes for placeholders (IframeNodeBody/index.css): embeds are
 * unreadable there, yet each still pays raster + a compositor layer, and at
 * overview zoom every animated iframe is in-viewport so rAF/CSS animations
 * all run (measured 40%/55% frames >20ms on a 40-iframe canvas —
 * docs/performance-verification-large-canvas.md). settledScale is frozen
 * during gestures, so the class flips once per gesture, not per wheel tick.
 */
export const OVERVIEW_SCALE_THRESHOLD = 0.35;

export const getCanvasTransformClassName = (
  moving: boolean,
  animating: boolean,
  settledScale: number,
): string =>
  `canvas-transform${moving || animating ? ' canvas-transform--moving' : ''}` +
  `${settledScale < 0.6 ? ' canvas-transform--small' : ''}` +
  `${settledScale < OVERVIEW_SCALE_THRESHOLD ? ' canvas-transform--overview' : ''}`;

interface NodeRenderGroup {
  containers: CanvasNode[];
  regular: CanvasNode[];
}

interface CanvasSurfaceProps {
  transform: { x: number; y: number; scale: number };
  transformLayerRef: RefObject<HTMLDivElement>;
  /** Scale as of the last moment the canvas was at rest (useCanvas).
   *  Drives `--canvas-scale` and the `--small` class INSTEAD of the live
   *  `transform.scale`: both restyle/repaint content inside the promoted
   *  compositor layer, and doing that per wheel tick invalidates the
   *  layer's tiles mid-gesture — the re-raster storm behind "tile memory
   *  limits exceeded" blank flashes. While a gesture is in flight the
   *  scale-compensated UI (terminal glyphs, frame headers) stretches with
   *  the canvas and snaps crisp once the gesture settles. */
  settledScale: number;
  animating: boolean;
  /** True while the user is actively panning/zooming. Drives conditional
   *  `will-change: transform` so the canvas subtree is only promoted to
   *  its own compositor layer while it's actually moving — avoiding the
   *  permanent tile-memory cost that otherwise trips Chromium's
   *  "tile memory limits exceeded" warning on canvases with many
   *  (especially nested) frames. */
  moving: boolean;
  renderGroups: NodeRenderGroup;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  rootFolder?: string;
  canvasId: string;
  canvasName?: string;
  draggingId: string | null;
  /** Every node participating in the current drag — includes descendants of a
   *  dragged frame so the full group can share the lifted stacking context. */
  draggingIds: Set<string>;
  dragPreview?: NodeDragPreview | null;
  /** Live delta for the current drag (B7) — every node in draggingIds/
   *  draggingId renders at `node.x/y + dragOffset` instead of the stored
   *  x/y, which stays frozen until the gesture commits. */
  dragOffset?: NodeDragOffset | null;
  resizingId: string | null;
  resizePreview?: NodeResizePreview | null;
  selectedNodeIdSet: Set<string>;
  selectedEdgeId: string | null;
  highlightedId: string | null;
  externallyEditedIds: Set<string>;
  /** Live edge interaction state — passed straight to the edges layer so it
   *  can render the preview / highlight the hover target. */
  edgeInteractionState: EdgeInteractionState | null;
  /** Preview endpoints resolved by the interaction hook. Null when no
   *  connect/move-end drag is in flight. */
  edgePreviewEndpoints: { s: Point; t: Point } | null;
  /** Live shape-draw draft. Null unless the user is currently dragging
   *  out a new shape. */
  shapeDraft?: ShapeDraft | null;
  /** Live marquee rectangle (canvas coordinates) while a box-select drag
   *  is in flight, null otherwise. Renders a dashed selection box. */
  marqueeRect?: MarqueeRect | null;
  /** Active alignment guides for the current drag, in canvas
   *  coordinates. Empty when nothing is snapping. */
  snapLines?: SnapLine[];
  focusedNodeIds?: Set<string>;
  focusContextNodeIds?: Set<string>;
  focusModeEnabled?: boolean;
  onDragStart: (e: React.MouseEvent, node: CanvasNode) => void;
  onResizeStart: (
    e: React.MouseEvent,
    nodeId: string,
    width: number,
    height: number,
    edge: ResizeEdge,
    minWidth?: number,
    minHeight?: number
  ) => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  /** Dimension-only update that bypasses undo history. Used by nodes
   *  whose size is derived from their content (e.g. mindmap auto-fits
   *  to its topic tree) so every typed character doesn't spam the
   *  history stack with a paired text + resize entry. */
  onAutoResize: (id: string, width: number, height: number) => void;
  onRemove: (id: string) => void;
  onRemoveNodes?: (ids: string[]) => void;
  onExportMindmapImage: (id: string) => void;
  /** Selection callback that forwards optional shift/meta modifiers so
   *  the parent can honor multi-select intent. */
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onFocus: (node: CanvasNode) => void;
  onReference?: (nodeId: string) => void;
  onAddToChat?: (nodeId: string) => void;
  onAddDomSelectionToChat?: (selection: AgentContextDomSelectionRef) => void;
  onSubmitDomReviewComments?: (comments: AgentContextDomReviewComment[]) => Promise<boolean>;
  resolveReferenceNode?: (node: CanvasNode) => { node?: CanvasNode; workspaceName?: string };
  onOpenReferenceSource?: (node: CanvasNode) => void;
  onUpdateReferenceSource?: (referenceNode: CanvasNode, patch: Partial<CanvasNode>) => void;
  onUngroupSelectedGroups?: () => void;
  /** Node currently rendered fullscreen, if any. The matching
   *  CanvasNodeView stays in place inside `.canvas-transform` so its
   *  iframe / editor / terminal DOM never moves; CSS overrides on
   *  `.canvas-transform` and the node fill the viewport. */
  fullscreenNodeId?: string | null;
  onToggleFullscreen?: (nodeId: string) => void;
  onExitFullscreen?: () => void;
  onSelectEdge: (id: string | null) => void;
  onEdgeHandleMouseDown: (
    edgeId: string,
    handle: 'source' | 'target' | 'bend',
    e: React.MouseEvent,
    ctx: { s: Point; t: Point },
  ) => void;
  /** Mousedown on the edge body (not a handle). Starts a "translate
   *  the whole edge" drag. */
  onEdgeBodyMouseDown: (edgeId: string, e: React.MouseEvent) => void;
  /** Double-click on the edge body. Opens the edge-label editor. */
  onEdgeBodyDoubleClick: (edgeId: string, e: React.MouseEvent) => void;
  /** Right-click on the edge body. Opens the edge context menu. */
  onEdgeBodyContextMenu?: (edgeId: string, e: React.MouseEvent) => void;
  getAllNodes: () => CanvasNode[];
}

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
  externallyEditedIds,
  edgeInteractionState,
  edgePreviewEndpoints,
  shapeDraft,
  marqueeRect,
  snapLines,
  focusedNodeIds,
  focusContextNodeIds,
  focusModeEnabled = false,
  onDragStart,
  onResizeStart,
  onUpdate,
  onAutoResize,
  onRemove,
  onRemoveNodes,
  onExportMindmapImage,
  onSelect,
  onFocus,
  onReference,
  onAddToChat,
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
      onSelect={onSelect}
      onFocus={onFocus}
      onReference={onReference}
      onAddToChat={onAddToChat}
      onAddDomSelectionToChat={onAddDomSelectionToChat}
      onSubmitDomReviewComments={onSubmitDomReviewComments}
      resolveReferenceNode={resolveReferenceNode}
      onOpenReferenceSource={onOpenReferenceSource}
      onUpdateReferenceSource={onUpdateReferenceSource}
      onUngroupSelectedGroups={onUngroupSelectedGroups}
      isFullscreen={fullscreenNodeId === node.id}
      onToggleFullscreen={onToggleFullscreen}
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

/**
 * Dashed rectangle drawn while the user box-selects on blank canvas.
 * Lives inside `.canvas-transform` so the box scales with zoom and
 * pans with the rest of the surface — matches the convention that
 * canvas-coordinate UI renders here, not in the screen-space overlay
 * layer. The border width is divided by the zoom (same trick as
 * CanvasAlignmentGuides) so it reads as ~1px on screen at any scale.
 */
const MarqueePreview = ({ rect, scale }: { rect: MarqueeRect; scale: number }) => {
  if (rect.width <= 0 && rect.height <= 0) return null;
  const borderPx = 1 / Math.max(scale, 0.0001);
  return (
    <div
      className="canvas-marquee"
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: Math.max(1, rect.width),
        height: Math.max(1, rect.height),
        border: `${borderPx}px solid #5B7CBF`,
        background: 'rgba(91, 124, 191, 0.08)',
        pointerEvents: 'none',
        boxSizing: 'border-box',
      }}
    />
  );
};

/**
 * Dashed outline shown while the user drags out a new shape. Lives inside
 * `.canvas-transform`, so canvas coords render correctly at any zoom/pan.
 * Pointer events are disabled so the overlay above it still receives the
 * ongoing mousemove/mouseup.
 */
const ShapeDraftPreview = ({ draft, scale }: { draft: ShapeDraft; scale: number }) => {
  const x = Math.min(draft.start.x, draft.current.x);
  const y = Math.min(draft.start.y, draft.current.y);
  const w = Math.max(1, Math.abs(draft.current.x - draft.start.x));
  const h = Math.max(1, Math.abs(draft.current.y - draft.start.y));
  return (
    <svg
      className="shape-draft-preview"
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: w,
        height: h,
        pointerEvents: 'none',
        overflow: 'visible',
      }}
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
    >
      <ShapePrimitive
        kind={draft.kind}
        width={w}
        height={h}
        fill="rgba(91, 124, 191, 0.08)"
        stroke="#5B7CBF"
        strokeWidth={1.5 / Math.max(scale, 0.0001)}
      />
    </svg>
  );
};

interface GestureHudProps {
  dragPreview?: NodeDragPreview | null;
  resizePreview?: NodeResizePreview | null;
  scale: number;
}

const CanvasGestureHud = ({ dragPreview, resizePreview, scale }: GestureHudProps) => {
  const { t } = useI18n();
  const preview = dragPreview
    ? {
        x: dragPreview.x,
        y: dragPreview.y,
        width: dragPreview.width,
        height: dragPreview.height,
      }
    : resizePreview
      ? {
          x: resizePreview.x,
          y: resizePreview.y,
          width: resizePreview.width,
          height: resizePreview.height,
        }
      : null;

  if (!preview) return null;

  const safeScale = Math.max(scale, 0.0001);
  const label = dragPreview
    ? dragPreview.count > 1
      ? t('canvas.gesture.movingMany', { count: dragPreview.count })
      : t('canvas.gesture.movingOne')
    : t('canvas.gesture.resizing');
  const dimensions = `${Math.round(preview.width)} x ${Math.round(preview.height)}`;
  const position = dragPreview
    ? `X ${Math.round(preview.x)}  Y ${Math.round(preview.y)}`
    : null;

  return (
    <div
      className="canvas-gesture-hud"
      aria-hidden="true"
      style={{
        left: preview.x,
        top: preview.y + preview.height + (8 / safeScale),
        transform: `scale(${1 / safeScale})`,
      } as React.CSSProperties}
    >
      <div className="canvas-gesture-hud__main">
        <span>{label}</span>
        {dragPreview?.snapDisabled && (
          <span className="canvas-gesture-hud__badge">{t('canvas.gesture.freeMove')}</span>
        )}
      </div>
      <div className="canvas-gesture-hud__meta">
        {position && <span>{position}</span>}
        <span>{dimensions}</span>
      </div>
    </div>
  );
};
