import type { CanvasNode, EdgeAnchor, EdgeEndpoint } from '../types';

let edgeIdCounter = 0;
export function genEdgeId(): string {
  return `edge-${Date.now()}-${++edgeIdCounter}`;
}

/**
 * Short human-readable title for an edge endpoint, used when describing
 * connections back to the agent. Falls back to `point(x, y)` for free
 * endpoints and `[id]` for unresolved nodes.
 */
export function describeEndpoint(endpoint: EdgeEndpoint, nodesById: Map<string, CanvasNode>): string {
  if (endpoint.kind === 'point') {
    return `point(${Math.round(endpoint.x)}, ${Math.round(endpoint.y)})`;
  }
  const node = nodesById.get(endpoint.nodeId);
  if (!node) return `[${endpoint.nodeId}] (missing)`;
  return `[${node.id}] "${node.title || node.type}"`;
}

/**
 * Build an EdgeEndpoint from the flat source/target fields on the tool
 * input. Prefers `nodeId` when both a node ref and explicit x/y are
 * supplied, and throws if neither is provided.
 */
export function buildEndpoint(args: {
  nodeId?: string;
  anchor?: string;
  x?: number;
  y?: number;
  which: 'source' | 'target';
}): EdgeEndpoint {
  if (args.nodeId) {
    const anchor = (args.anchor as EdgeAnchor | undefined) ?? 'auto';
    return { kind: 'node', nodeId: args.nodeId, anchor };
  }
  if (typeof args.x === 'number' && typeof args.y === 'number') {
    return { kind: 'point', x: args.x, y: args.y };
  }
  throw new Error(
    `canvas_create_edge: ${args.which} endpoint needs either \`${args.which}NodeId\` ` +
      `or both \`${args.which}X\` and \`${args.which}Y\`.`,
  );
}
