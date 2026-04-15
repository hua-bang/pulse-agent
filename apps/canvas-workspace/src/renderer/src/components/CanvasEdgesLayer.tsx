import { useMemo } from 'react';
import type { CanvasEdge, CanvasNode, EdgeArrowCap, EdgeStroke } from '../types';
import { resolveEndpoint } from '../utils/edgeFactory';

interface Props {
  edges: CanvasEdge[];
  nodes: CanvasNode[];
}

const DEFAULT_STROKE: Required<EdgeStroke> = {
  color: '#1f2328',
  width: 1.6,
  style: 'solid',
};

const strokeDasharray = (style: EdgeStroke['style']): string | undefined => {
  switch (style) {
    case 'dashed': return '6 4';
    case 'dotted': return '1.5 3';
    case 'solid':
    default:       return undefined;
  }
};

/**
 * Signed perpendicular offset → quadratic Bezier control point.
 * The control point sits at (midpoint + normal * bend). A positive bend
 * bows the curve to the right of the s→t direction, negative to the left.
 * Bend of 0 produces a degenerate quadratic that renders as a straight
 * line, which is exactly what we want.
 */
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
  // Unit perpendicular (rotate 90° CCW: (dy/len, -dx/len) points to the
  // right when looking from source to target in screen coords).
  const nx = dy / len;
  const ny = -dx / len;
  return { cx: mx + nx * bend, cy: my + ny * bend };
};

const capId = (
  prefix: string,
  cap: EdgeArrowCap,
  color: string,
): string => {
  // One marker per (cap, color) — no per-edge markers. This keeps the
  // SVG lean when many edges share the same style. Color is part of the
  // id because <marker> fill inherits from the marker, not the path.
  const hex = color.replace(/[^a-zA-Z0-9]/g, '_');
  return `${prefix}-${cap}-${hex}`;
};

/**
 * Emit exactly the set of <marker> defs the current edges reference.
 * Walking the edges once and de-duplicating avoids bloating the DOM
 * with unused caps.
 */
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

const MarkerShape = ({ cap, color }: { cap: EdgeArrowCap; color: string }) => {
  switch (cap) {
    case 'triangle':
      // Filled triangle pointing along the +x axis (tangent direction).
      return <path d="M0,0 L10,5 L0,10 z" fill={color} />;
    case 'arrow':
      // Open V-shape.
      return (
        <path
          d="M0,0 L10,5 L0,10"
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    case 'dot':
      return <circle cx={5} cy={5} r={3.2} fill={color} />;
    case 'bar':
      return <rect x={4} y={0} width={2} height={10} fill={color} />;
    case 'none':
    default:
      return null;
  }
};

const Markers = ({
  markers,
}: {
  markers: Array<{ id: string; cap: EdgeArrowCap; color: string; side: 'head' | 'tail' }>;
}) => (
  <defs>
    {markers.map(({ id, cap, color, side }) => (
      <marker
        key={id}
        id={id}
        markerWidth={12}
        markerHeight={12}
        viewBox="0 0 10 10"
        // Head caps point forward along the path's tangent; tail caps are
        // flipped 180° so they point away from the source.
        orient={side === 'head' ? 'auto' : 'auto-start-reverse'}
        // Offset the reference point so the cap sits at the path end
        // without overshooting. For triangles we put refX at the tip (10)
        // so the tip lands exactly on the endpoint.
        refX={cap === 'triangle' ? 10 : 5}
        refY={5}
        markerUnits="userSpaceOnUse"
      >
        <MarkerShape cap={cap} color={color} />
      </marker>
    ))}
  </defs>
);

/**
 * Renders all edges for the canvas as a single SVG layer stacked beneath
 * the node views. Lives inside `.canvas-transform`, so panning/zooming
 * gets it for free; `vector-effect="non-scaling-stroke"` keeps line
 * weights visually constant through scale.
 *
 * Interaction is disabled in Step 1 — the layer is `pointer-events: none`
 * end-to-end. Step 2 will add a wider transparent hit-proxy path per
 * edge for selection/dragging.
 */
export const CanvasEdgesLayer = ({ edges, nodes }: Props) => {
  const nodesById = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const markers = useMarkerDefs(edges);

  if (edges.length === 0) return null;

  return (
    <svg
      className="canvas-edges"
      // Tiny base size — we rely on overflow:visible so paths at arbitrary
      // canvas coords (including negative) still render. The parent div
      // does the panning/zooming via CSS transform; we just draw in its
      // local coordinate space.
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
      {edges.map((edge) => {
        const s = resolveEndpoint(edge.source, nodesById);
        const t = resolveEndpoint(edge.target, nodesById);
        const bend = edge.bend ?? 0;
        const { cx, cy } = bendControlPoint(s.x, s.y, t.x, t.y, bend);
        const d = bend === 0
          ? `M ${s.x} ${s.y} L ${t.x} ${t.y}`
          : `M ${s.x} ${s.y} Q ${cx} ${cy} ${t.x} ${t.y}`;

        const stroke = { ...DEFAULT_STROKE, ...edge.stroke };
        const head = edge.arrowHead ?? 'triangle';
        const tail = edge.arrowTail ?? 'none';

        return (
          <path
            key={edge.id}
            d={d}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeDasharray={strokeDasharray(stroke.style)}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            markerEnd={head !== 'none' ? `url(#${capId('edge-head', head, stroke.color)})` : undefined}
            markerStart={tail !== 'none' ? `url(#${capId('edge-tail', tail, stroke.color)})` : undefined}
          />
        );
      })}
    </svg>
  );
};
