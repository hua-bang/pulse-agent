import type { CanvasEdge, CanvasNode, EdgeAnchor, EdgeEndpoint } from '../types';

let edgeIdCounter = 0;
export const genEdgeId = (): string => `edge-${Date.now()}-${++edgeIdCounter}`;

/**
 * Create a new edge with sensible defaults:
 *  - no bend (straight line),
 *  - triangular arrow head on target, nothing on source,
 *  - thin solid black stroke.
 *
 * Visual defaults mirror tldraw's default arrow. The caller decides the
 * endpoints, kind, label, etc.
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
  stroke: { color: '#1f2328', width: 1.6, style: 'solid' },
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
