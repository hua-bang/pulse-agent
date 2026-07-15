import { memo, useMemo } from 'react';
import type {
  CanvasEdge,
  CanvasNode,
  EdgeArrowCap,
  EdgeStroke,
} from '../types';
import {
  resolveEndpoint,
  resolveEndpointToward,
} from '../utils/edgeFactory';
import type { EdgeInteractionState, Point } from '../hooks/useEdgeInteraction';
import {
  capId,
  EdgeHandles,
  Markers,
  PreviewEdge,
  SELECTION_COLOR,
} from './CanvasEdgesLayerParts';

export interface CanvasEdgesLayerProps {
  edges: CanvasEdge[];
  nodes: CanvasNode[];
  selectedEdgeId: string | null;
  onSelectEdge?: (id: string | null) => void;
  /** Live interaction state — renders preview / freezes the edge under
   *  drag. Optional because Step 1 call sites don't pass it. */
  interactionState?: EdgeInteractionState | null;
  /** Preview endpoints resolved by the interaction hook. When set, we
   *  draw a dashed draft line between these two points. */
  previewEndpoints?: { s: Point; t: Point } | null;
  focusedNodeIds?: Set<string>;
  focusContextNodeIds?: Set<string>;
  focusModeEnabled?: boolean;
  onHandleMouseDown?: (
    edgeId: string,
    handle: 'source' | 'target' | 'bend',
    e: React.MouseEvent,
    ctx: { s: Point; t: Point },
  ) => void;
  /** Mousedown on the edge body (not a handle). Used to start a "move
   *  the whole edge" drag — the hit-proxy forwards here and the
   *  interaction hook translates free-point endpoints by the cursor
   *  delta while leaving node-bound endpoints anchored. */
  onBodyMouseDown?: (edgeId: string, e: React.MouseEvent) => void;
  /** Double-click on the edge body. Used to enter edge-label edit mode.
   *  The hit-proxy swallows the event so it doesn't bubble up to the
   *  canvas-container's blank dbl-click handler (which spawns the
   *  new-node context menu). */
  onBodyDoubleClick?: (edgeId: string, e: React.MouseEvent) => void;
  /** Right-click on the edge body — opens the edge context menu. The
   *  hit-proxy swallows the event so the blank-canvas create menu
   *  doesn't open on top of it. */
  onBodyContextMenu?: (edgeId: string, e: React.MouseEvent) => void;
}

const DEFAULT_STROKE: Required<EdgeStroke> = {
  color: '#1f2328',
  width: 2.4,
  style: 'solid',
};

const HIT_PROXY_WIDTH = 10;
/** Edges fully outside the focus context fade to this opacity in focus
 * mode — matches the node dim level so the canvas reads as a single
 * cohesive faded layer behind the focused card. */
const FOCUS_DIMMED_EDGE_OPACITY = 0.12;
/** Edges with both endpoints inside a focused container's contents sit
 * a notch above the dim layer so the focused frame's internal
 * relationships stay legible. */
const FOCUS_CONTEXT_EDGE_OPACITY = 0.45;
/** Canvas-space gap between an arrow's tip and the node boundary it points
 *  at. Without this, the arrow-head marker sits flush against the node
 *  and gets visually swallowed by the node's background/border. tldraw
 *  leaves similar breathing room for the same reason. */
const ARROW_NODE_GAP = 6;

const strokeDasharray = (style: EdgeStroke['style']): string | undefined => {
  switch (style) {
    case 'dashed': return '6 4';
    case 'dotted': return '1.5 3';
    case 'solid':
    default:       return undefined;
  }
};

const bendControlPoint = (
  sx: number, sy: number,
  tx: number, ty: number,
  bend: number,
): { cx: number; cy: number } => {
  const mx = (sx + tx) / 2;
  const my = (sy + ty) / 2;
  if (!bend) return { cx: mx, cy: my };
  const dx = tx - sx;
  const dy = ty - sy;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dy / len;
  const ny = -dx / len;
  // bend = peak offset of rendered curve; control point sits at 2×bend
  // because a quadratic's t=0.5 value is (M + P1)/2 (see useEdgeInteraction).
  return { cx: mx + nx * bend * 2, cy: my + ny * bend * 2 };
};

const buildPathData = (s: Point, t: Point, bend: number): string => {
  if (!bend) return `M ${s.x} ${s.y} L ${t.x} ${t.y}`;
  const { cx, cy } = bendControlPoint(s.x, s.y, t.x, t.y, bend);
  return `M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`;
};

/** Apply render-only drag geometry without mutating the canonical edge. */
export const applyEdgeInteractionPreview = (
  edge: CanvasEdge,
  interactionState: EdgeInteractionState | null | undefined,
): CanvasEdge => {
  if (
    !interactionState ||
    interactionState.kind === 'connect' ||
    interactionState.edgeId !== edge.id
  ) {
    return edge;
  }
  const patch = interactionState.previewPatch;
  if (patch.source === undefined && patch.target === undefined && patch.bend === undefined) {
    return edge;
  }
  return { ...edge, ...patch };
};

/**
 * Pull the resolved `end` point back from the node boundary by `gap`
 * canvas units along the straight line from `other` → `end`. Used when
 * the endpoint is node-bound AND has a visible arrow cap, so the cap
 * doesn't render flush against the node (where it visually merges into
 * the node's border/background).
 *
 * Returns `end` unchanged when `gap` is 0 or the two points coincide.
 */
const insetTowardOther = (end: Point, other: Point, gap: number): Point => {
  if (gap <= 0) return end;
  const dx = end.x - other.x;
  const dy = end.y - other.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return end;
  return {
    x: end.x - (dx / len) * gap,
    y: end.y - (dy / len) * gap,
  };
};

const useMarkerDefs = (edges: CanvasEdge[]) => {
  return useMemo(() => {
    const markers = new Map<
      string,
      { id: string; cap: EdgeArrowCap; color: string; side: 'head' | 'tail' }
    >();
    for (const edge of edges) {
      const color = edge.stroke?.color ?? DEFAULT_STROKE.color;
      const head = edge.arrowHead ?? 'triangle';
      const tail = edge.arrowTail ?? 'none';
      if (head !== 'none') {
        const id = capId('edge-head', head, color);
        if (!markers.has(id)) markers.set(id, { id, cap: head, color, side: 'head' });
      }
      if (tail !== 'none') {
        const id = capId('edge-tail', tail, color);
        if (!markers.has(id)) markers.set(id, { id, cap: tail, color, side: 'tail' });
      }
    }
    return Array.from(markers.values());
  }, [edges]);
};

/**
 * Renders every edge as SVG inside `.canvas-transform`, plus:
 *  - a transparent thick hit-proxy stroke per edge so thin lines are
 *    still easy to click;
 *  - a pale highlight underneath the selected edge;
 *  - 3 handles (start, bend midpoint, end) on the selected edge;
 *  - a dashed preview edge while a connect/move-end drag is in flight.
 *
 * The layer itself has `pointer-events: none`; individual child
 * elements re-enable events (hit-proxies: `stroke`, handles: `all`).
 * This keeps node drag/resize/click behaviour untouched.
 */
const CanvasEdgesLayerComponent = ({
  edges,
  nodes,
  selectedEdgeId,
  onSelectEdge,
  interactionState,
  previewEndpoints,
  focusedNodeIds,
  focusContextNodeIds,
  focusModeEnabled = false,
  onHandleMouseDown,
  onBodyMouseDown,
  onBodyDoubleClick,
  onBodyContextMenu,
}: CanvasEdgesLayerProps) => {
  const nodesById = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const markers = useMarkerDefs(edges);

  // Resolve each edge's endpoints into absolute canvas coords. Auto-
  // anchored node-bound endpoints are shifted to their bbox-boundary
  // point toward the opposite endpoint, so edges visually terminate at
  // node edges rather than piercing into node centers. Additionally, if
  // the endpoint carries a visible arrow cap we inset it by a small gap
  // so the marker has clear space outside the node (otherwise the cap
  // sits flush against the node border and visually disappears).
  const resolved = useMemo(() => {
    return edges.map((edge) => {
      const renderedEdge = applyEdgeInteractionPreview(edge, interactionState);
      const approxS = resolveEndpoint(renderedEdge.source, nodesById);
      const approxT = resolveEndpoint(renderedEdge.target, nodesById);
      let s = resolveEndpointToward(renderedEdge.source, nodesById, approxT);
      let t = resolveEndpointToward(renderedEdge.target, nodesById, approxS);
      const head = renderedEdge.arrowHead ?? 'triangle';
      const tail = renderedEdge.arrowTail ?? 'none';
      if (renderedEdge.target.kind === 'node' && head !== 'none') {
        t = insetTowardOther(t, s, ARROW_NODE_GAP);
      }
      if (renderedEdge.source.kind === 'node' && tail !== 'none') {
        s = insetTowardOther(s, t, ARROW_NODE_GAP);
      }
      return { edge: renderedEdge, s, t };
    });
  }, [edges, interactionState, nodesById]);

  if (edges.length === 0 && !previewEndpoints) return null;

  return (
    <svg
      className="canvas-edges"
      width={1}
      height={1}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        overflow: 'visible',
        pointerEvents: 'none',
      }}
    >
      <Markers markers={markers} />

      {resolved.map(({ edge, s, t }) => {
        const bend = edge.bend ?? 0;
        const d = buildPathData(s, t, bend);
        const stroke = { ...DEFAULT_STROKE, ...edge.stroke };
        const head = edge.arrowHead ?? 'triangle';
        const tail = edge.arrowTail ?? 'none';
        const isSelected = edge.id === selectedEdgeId;
        const sourceFocused = edge.source.kind === 'node' && focusedNodeIds?.has(edge.source.nodeId);
        const targetFocused = edge.target.kind === 'node' && focusedNodeIds?.has(edge.target.nodeId);
        const sourceInContext = edge.source.kind === 'node' && focusContextNodeIds?.has(edge.source.nodeId);
        const targetInContext = edge.target.kind === 'node' && focusContextNodeIds?.has(edge.target.nodeId);
        // Strict: an edge is fully visible only when it touches a
        // focused node OR connects two siblings inside a focused
        // container. Edges that merely brush against context get the
        // mid-tier opacity so the focused frame's internal structure
        // stays readable, but external connections fade cleanly.
        const isFocused = !focusModeEnabled || isSelected || sourceFocused || targetFocused;
        const isContext = !isFocused && sourceInContext && targetInContext;
        const focusStyle: React.CSSProperties | undefined = focusModeEnabled && !isFocused
          ? { opacity: isContext ? FOCUS_CONTEXT_EDGE_OPACITY : FOCUS_DIMMED_EDGE_OPACITY }
          : undefined;
        // During move-* gestures this geometry may be an ephemeral copy
        // projected above. The canonical edge stays untouched until mouseup.

        return (
          <g key={edge.id} style={focusStyle}>
            {/* Wide transparent hit target so thin lines stay clickable.
                A mousedown on the body both selects the edge AND starts
                a "move the whole edge" drag via onBodyMouseDown. Free
                endpoints translate with the cursor; node-bound endpoints
                stay anchored to their node. Pointer moves only update the
                render preview; mouseup writes canonical geometry once, and
                a click without displacement writes nothing. The
                midpoint bend handle (rendered on top via EdgeHandles)
                still captures its own mousedowns for curving. */}
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={HIT_PROXY_WIDTH}
              vectorEffect="non-scaling-stroke"
              style={{
                pointerEvents: 'stroke',
                cursor: 'grab',
              }}
              onMouseDown={(e) => {
                // Selecting an edge steals the mousedown so it doesn't
                // bubble up into the canvas-container's blank-click
                // deselect logic.
                e.stopPropagation();
                onSelectEdge?.(edge.id);
                onBodyMouseDown?.(edge.id, e);
              }}
              onDoubleClick={(e) => {
                // Swallow so the canvas-container's blank-area dbl-click
                // handler (which opens the new-node context menu) doesn't
                // fire. The parent opens the edge-label editor instead.
                e.stopPropagation();
                onBodyDoubleClick?.(edge.id, e);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onBodyContextMenu?.(edge.id, e);
              }}
            />
            {/* Selection underlay: soft blue tint, rendered under the
                real stroke so the edge's own color still reads. Scales
                with the canvas (no non-scaling-stroke) so it stays
                visibly wider than the main stroke at every zoom — a
                fixed-pixel underlay would get visually swallowed once
                the zoomed-up main stroke caught up in width. */}
            {isSelected && (
              <path
                d={d}
                fill="none"
                stroke={SELECTION_COLOR}
                strokeOpacity={0.35}
                strokeWidth={(stroke.width ?? DEFAULT_STROKE.width) + 6}
                strokeLinecap="round"
              />
            )}
            {/* Handles for the selected edge. Rendered BEFORE the visible
                stroke so the stroke (and more importantly its markers)
                paint on top — without this, the white-filled target
                handle circle sits over the arrow-head marker and the
                triangle visually disappears. The stroke itself passes
                through the handle but is only a few pixels wide, so
                the handle's ring stays clearly readable. */}
            {isSelected && onHandleMouseDown && (
              <EdgeHandles
                edge={edge}
                s={s}
                t={t}
                onHandleMouseDown={(handle, e) =>
                  onHandleMouseDown(edge.id, handle, e, { s, t })
                }
              />
            )}
            {/* Visible stroke. Linecap is "butt" whenever the matching
                end has an arrow marker — SVG places the marker's refPoint
                AT the path endpoint, so a rounded cap (radius = half
                stroke width) would poke forward *past* the triangle tip
                and make the arrow look slightly disconnected from the
                line. Using "butt" ends the stroke flush with the path
                endpoint so the triangle's tip becomes the exact rightmost
                point of the arrow. Edges with no caps at all keep "round"
                for their nicer free-end look.

                No vectorEffect here: content strokes should scale with
                canvas zoom so the marker (also sized in user-space via
                markerUnits="strokeWidth") stays proportional to the line
                at every zoom. With non-scaling-stroke the line would
                stay thin while the marker ballooned, producing the
                cartoonishly oversized arrow reported earlier. */}
            <path
              d={d}
              fill="none"
              stroke={stroke.color}
              strokeWidth={stroke.width}
              strokeDasharray={strokeDasharray(stroke.style)}
              strokeLinecap={head !== 'none' || tail !== 'none' ? 'butt' : 'round'}
              markerEnd={head !== 'none' ? `url(#${capId('edge-head', head, stroke.color)})` : undefined}
              markerStart={tail !== 'none' ? `url(#${capId('edge-tail', tail, stroke.color)})` : undefined}
            />
          </g>
        );
      })}

      {previewEndpoints && (
        <PreviewEdge
          s={previewEndpoints.s}
          t={previewEndpoints.t}
          highlightNodeId={interactionState?.kind === 'connect' || interactionState?.kind === 'move-end'
            ? interactionState.hoverNodeId
            : null}
          nodesById={nodesById}
        />
      )}
    </svg>
  );
};

// Measured with an isolated re-render harness (Profiler around
// CanvasSurface, 100 nodes + 100 edges, a 50-tick pan/zoom wheel burst):
// without this memo boundary, every wheel tick (CanvasSurface's parent
// re-rendering on the transform state change) forced this component to
// re-render and React to reconcile its full SVG subtree even though edges/
// nodes/selection hadn't changed — 100 edges cost ~2.2ms/tick vs ~0.5ms/tick
// at 0 edges (3.5x more total main-thread time across the burst; after this
// memo, both were ~equal). Handler props are intentionally excluded from
// the comparator, matching CanvasNodeView's memo in that sibling component:
// callers (CanvasSurface -> CanvasRootView -> Canvas/index.tsx) pass these
// as fresh inline closures every render, but they all close over stable
// setState/hook-returned functions, so evaluating a "stale" closure
// instance still calls through to the current state setter. Exported (not
// inlined in the memo() call) so the comparator has a direct unit-test
// surface instead of depending on Profiler/memo bail-out semantics, which
// don't reliably reflect "did the function body re-run" in a test harness.
export const canvasEdgesLayerPropsAreEqual = (prev: CanvasEdgesLayerProps, next: CanvasEdgesLayerProps): boolean => (
  prev.edges === next.edges &&
  prev.nodes === next.nodes &&
  prev.selectedEdgeId === next.selectedEdgeId &&
  prev.interactionState === next.interactionState &&
  prev.previewEndpoints === next.previewEndpoints &&
  prev.focusedNodeIds === next.focusedNodeIds &&
  prev.focusContextNodeIds === next.focusContextNodeIds &&
  prev.focusModeEnabled === next.focusModeEnabled
);

export const CanvasEdgesLayer = memo(CanvasEdgesLayerComponent, canvasEdgesLayerPropsAreEqual);
