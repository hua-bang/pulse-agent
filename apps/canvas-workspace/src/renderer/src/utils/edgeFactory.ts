import type { CanvasEdge, CanvasNode, EdgeAnchor, EdgeEndpoint } from '../types';
import { DEFAULT_EDGE_STROKE } from '../../../shared/canvas';

type Point = { x: number; y: number };
type UnitVector = { x: number; y: number };

export interface EdgePathGeometry {
  d: string;
  midpoint: Point;
}

export interface ResolvedEdgePathGeometry extends EdgePathGeometry {
  sourcePoint: Point;
  targetPoint: Point;
}

const ARROW_NODE_GAP = 6;

const ANCHOR_NORMALS: Record<Exclude<EdgeAnchor, 'auto'>, UnitVector> = {
  top: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  bottom: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

let edgeIdCounter = 0;
export const genEdgeId = (): string => `edge-${Date.now()}-${++edgeIdCounter}`;

/**
 * Create a new edge with sensible defaults:
 *  - no manual bend (node-bound edges use automatic smooth routing),
 *  - triangular arrow head on target, nothing on source,
 *  - high-contrast solid stroke matching the large "L" width tick in
 *    EdgeStylePanel, so it remains legible while zoomed out.
 *
 * Visual defaults mirror Heptabase's canvas-space connector treatment.
 * The caller decides the endpoints, kind, label, etc.
 */
export const createDefaultEdge = (
  source: EdgeEndpoint,
  target: EdgeEndpoint,
  overrides?: Partial<Omit<CanvasEdge, 'id' | 'source' | 'target'>>,
): CanvasEdge => ({
  id: genEdgeId(),
  source,
  target,
  bend: 0,
  arrowHead: 'triangle',
  arrowTail: 'none',
  stroke: { ...DEFAULT_EDGE_STROKE },
  updatedAt: Date.now(),
  ...overrides,
});

/**
 * Compute the point on a node's bounding box that corresponds to a given
 * anchor side. `auto` resolves to the node's center — callers that want
 * edge-hugging visuals should compute a side-specific anchor themselves
 * (e.g. the side closest to the other endpoint) and pass it explicitly.
 */
export const nodeAnchorPoint = (
  node: Pick<CanvasNode, 'x' | 'y' | 'width' | 'height'>,
  anchor: EdgeAnchor = 'auto',
): { x: number; y: number } => {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  switch (anchor) {
    case 'top':    return { x: cx, y: node.y };
    case 'bottom': return { x: cx, y: node.y + node.height };
    case 'left':   return { x: node.x, y: cy };
    case 'right':  return { x: node.x + node.width, y: cy };
    case 'auto':
    default:       return { x: cx, y: cy };
  }
};

/**
 * Resolve an endpoint into absolute canvas coordinates. Node-bound
 * endpoints whose target no longer exists fall back to (0, 0) — callers
 * should filter or degrade such edges before rendering; this is only a
 * safety net so a stale reference doesn't crash the renderer.
 */
export const resolveEndpoint = (
  endpoint: EdgeEndpoint,
  nodesById: Map<string, CanvasNode>,
): { x: number; y: number } => {
  if (endpoint.kind === 'point') {
    return { x: endpoint.x, y: endpoint.y };
  }
  const node = nodesById.get(endpoint.nodeId);
  if (!node) return { x: 0, y: 0 };
  return nodeAnchorPoint(node, endpoint.anchor);
};

/**
 * For a node-bound endpoint with `anchor: 'auto'`, compute the point on
 * the node's bounding box closest to `toward` along the straight line
 * from center to `toward`. This makes edges visually terminate at the
 * node's edge rather than piercing into its center — the same trick
 * tldraw uses for arrow↔shape binding.
 *
 * For explicit anchors (top/right/bottom/left), we still return the
 * anchor-side midpoint so the user's choice wins.
 *
 * For free-point endpoints we return the point unchanged.
 */
export const resolveEndpointToward = (
  endpoint: EdgeEndpoint,
  nodesById: Map<string, CanvasNode>,
  toward: { x: number; y: number },
): { x: number; y: number } => {
  if (endpoint.kind === 'point') return { x: endpoint.x, y: endpoint.y };
  const node = nodesById.get(endpoint.nodeId);
  if (!node) return { x: 0, y: 0 };
  if (endpoint.anchor && endpoint.anchor !== 'auto') {
    return nodeAnchorPoint(node, endpoint.anchor);
  }
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const hw = node.width / 2;
  const hh = node.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  const tx = adx > 0 ? hw / adx : Infinity;
  const ty = ady > 0 ? hh / ady : Infinity;
  const t = Math.min(tx, ty);
  return { x: cx + dx * t, y: cy + dy * t };
};

/**
 * Hit-test a canvas coordinate against the node list. Iterates in
 * reverse so later-painted (i.e. visually on-top) nodes win. Frames
 * render under non-frames (see Canvas sortedNodes), so a click inside
 * a frame that also contains a node correctly returns the inner node.
 *
 * Returns null if no node covers the point.
 */
export const findNodeAtCanvasPoint = (
  sortedNodes: CanvasNode[],
  x: number,
  y: number,
): CanvasNode | null => {
  for (let i = sortedNodes.length - 1; i >= 0; i--) {
    const n = sortedNodes[i];
    if (x >= n.x && x <= n.x + n.width && y >= n.y && y <= n.y + n.height) {
      return n;
    }
  }
  return null;
};

/**
 * Signed perpendicular offset of `cursor` from the straight line s→t.
 * Positive = right-hand side of s→t (matches `bendControlPoint`'s sign
 * convention), negative = left.
 *
 * `bend` in CanvasEdge semantics equals this offset directly (it's the
 * peak-offset of the rendered curve), so this is the exact value to
 * write back while dragging the bend handle.
 */
export const bendFromCursor = (
  s: { x: number; y: number },
  t: { x: number; y: number },
  cursor: { x: number; y: number },
): number => {
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return 0;
  const mx = (s.x + t.x) / 2;
  const my = (s.y + t.y) / 2;
  const px = dy / len;
  const py = -dx / len;
  return (cursor.x - mx) * px + (cursor.y - my) * py;
};

/**
 * Position of the bend handle in canvas coords — i.e. where the curve
 * visually peaks. Since `bend` is itself the peak offset, the handle
 * sits at midpoint + normal·bend.
 */
export const bendHandlePoint = (
  s: { x: number; y: number },
  t: { x: number; y: number },
  bend: number,
): { x: number; y: number } => {
  const mx = (s.x + t.x) / 2;
  const my = (s.y + t.y) / 2;
  if (!bend) return { x: mx, y: my };
  const dx = t.x - s.x;
  const dy = t.y - s.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dy / len;
  const ny = -dx / len;
  return { x: mx + nx * bend, y: my + ny * bend };
};

const endpointOutwardNormal = (
  endpoint: EdgeEndpoint,
  point: Point,
  nodesById: Map<string, CanvasNode>,
): UnitVector | null => {
  if (endpoint.kind === 'point') return null;
  if (endpoint.anchor && endpoint.anchor !== 'auto') return ANCHOR_NORMALS[endpoint.anchor];
  const node = nodesById.get(endpoint.nodeId);
  if (!node) return null;
  const sides: Array<{ distance: number; normal: UnitVector }> = [
    { distance: Math.abs(point.x - node.x), normal: ANCHOR_NORMALS.left },
    { distance: Math.abs(point.x - (node.x + node.width)), normal: ANCHOR_NORMALS.right },
    { distance: Math.abs(point.y - node.y), normal: ANCHOR_NORMALS.top },
    { distance: Math.abs(point.y - (node.y + node.height)), normal: ANCHOR_NORMALS.bottom },
  ];
  return sides.reduce((closest, side) =>
    side.distance < closest.distance ? side : closest).normal;
};

/**
 * Build the visible path and its t=0.5 point from one geometry source.
 * Node-bound zero-bend edges use cubic handles that leave and enter along
 * the two anchor normals; free endpoints remain straight, while a non-zero
 * bend preserves the existing manually controlled quadratic curve.
 */
export const edgePathGeometry = (
  edge: Pick<CanvasEdge, 'source' | 'target' | 'bend'>,
  s: Point,
  t: Point,
  nodesById: Map<string, CanvasNode>,
): EdgePathGeometry => {
  const bend = edge.bend ?? 0;
  if (bend) {
    const midpoint = bendHandlePoint(s, t, bend);
    const baseMidpoint = bendHandlePoint(s, t, 0);
    const control = {
      x: midpoint.x * 2 - baseMidpoint.x,
      y: midpoint.y * 2 - baseMidpoint.y,
    };
    return {
      d: `M ${s.x} ${s.y} Q ${control.x} ${control.y} ${t.x} ${t.y}`,
      midpoint,
    };
  }

  const sourceNormal = endpointOutwardNormal(edge.source, s, nodesById);
  const targetNormal = endpointOutwardNormal(edge.target, t, nodesById);
  if (sourceNormal && targetNormal) {
    const distance = Math.hypot(t.x - s.x, t.y - s.y);
    const handleLength = distance / 3;
    const c1 = {
      x: s.x + sourceNormal.x * handleLength,
      y: s.y + sourceNormal.y * handleLength,
    };
    const c2 = {
      x: t.x + targetNormal.x * handleLength,
      y: t.y + targetNormal.y * handleLength,
    };
    return {
      d: `M ${s.x} ${s.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${t.x} ${t.y}`,
      midpoint: {
        x: (s.x + 3 * c1.x + 3 * c2.x + t.x) / 8,
        y: (s.y + 3 * c1.y + 3 * c2.y + t.y) / 8,
      },
    };
  }

  return {
    d: `M ${s.x} ${s.y} L ${t.x} ${t.y}`,
    midpoint: bendHandlePoint(s, t, 0),
  };
};

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

/**
 * Resolve the exact path rendered for an edge, including automatic anchors
 * and the small node gap reserved for visible arrow caps.
 */
export const resolveEdgePathGeometry = (
  edge: CanvasEdge,
  nodesById: Map<string, CanvasNode>,
): ResolvedEdgePathGeometry => {
  const approxS = resolveEndpoint(edge.source, nodesById);
  const approxT = resolveEndpoint(edge.target, nodesById);
  let sourcePoint = resolveEndpointToward(edge.source, nodesById, approxT);
  let targetPoint = resolveEndpointToward(edge.target, nodesById, approxS);
  const head = edge.arrowHead ?? 'triangle';
  const tail = edge.arrowTail ?? 'none';
  if (edge.target.kind === 'node' && head !== 'none') {
    targetPoint = insetTowardOther(targetPoint, sourcePoint, ARROW_NODE_GAP);
  }
  if (edge.source.kind === 'node' && tail !== 'none') {
    sourcePoint = insetTowardOther(sourcePoint, targetPoint, ARROW_NODE_GAP);
  }
  return {
    sourcePoint,
    targetPoint,
    ...edgePathGeometry(edge, sourcePoint, targetPoint, nodesById),
  };
};

/**
 * Turn every node-bound endpoint that points at `deletedNodeId` into a
 * free point at the node's last-known anchor coordinate. Edges whose
 * endpoints don't reference the deleted node are returned unchanged (by
 * reference, so React bail-outs stay effective).
 */
export const degradeEndpointsForDeletedNode = (
  edges: CanvasEdge[],
  deletedNode: CanvasNode,
): CanvasEdge[] => {
  const deletedId = deletedNode.id;
  const now = Date.now();
  return edges.map((edge) => {
    const touchesSource = edge.source.kind === 'node' && edge.source.nodeId === deletedId;
    const touchesTarget = edge.target.kind === 'node' && edge.target.nodeId === deletedId;
    if (!touchesSource && !touchesTarget) return edge;
    const next: CanvasEdge = { ...edge, updatedAt: now };
    if (touchesSource) {
      const anchor = edge.source.kind === 'node' ? edge.source.anchor : 'auto';
      const p = nodeAnchorPoint(deletedNode, anchor);
      next.source = { kind: 'point', x: p.x, y: p.y };
    }
    if (touchesTarget) {
      const anchor = edge.target.kind === 'node' ? edge.target.anchor : 'auto';
      const p = nodeAnchorPoint(deletedNode, anchor);
      next.target = { kind: 'point', x: p.x, y: p.y };
    }
    return next;
  });
};
