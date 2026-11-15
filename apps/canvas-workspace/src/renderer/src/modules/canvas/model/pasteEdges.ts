import type { CanvasEdge } from '../../../types';
import { genEdgeId } from '../../../../../shared/canvas-node-defaults';

/** Edges whose two ends both attach to a node in `nodeIds`. */
export const internalEdges = (
  edges: readonly CanvasEdge[],
  nodeIds: ReadonlySet<string>,
): CanvasEdge[] => edges.filter((edge) => (
  edge.source.kind === 'node'
  && edge.target.kind === 'node'
  && nodeIds.has(edge.source.nodeId)
  && nodeIds.has(edge.target.nodeId)
));

/**
 * Copy edges onto pasted nodes. Each copy gets a new id, and its ends move
 * to the pasted node ids in `idMap`. An edge with an end outside `idMap` is
 * dropped, so a copy never links back to the original nodes.
 */
export const cloneEdgesForPaste = (
  edges: readonly CanvasEdge[],
  idMap: ReadonlyMap<string, string>,
  now = Date.now(),
): CanvasEdge[] => internalEdges(edges, new Set(idMap.keys())).map((edge) => ({
  ...edge,
  id: genEdgeId(),
  source: edge.source.kind === 'node'
    ? { ...edge.source, nodeId: idMap.get(edge.source.nodeId) ?? edge.source.nodeId }
    : edge.source,
  target: edge.target.kind === 'node'
    ? { ...edge.target, nodeId: idMap.get(edge.target.nodeId) ?? edge.target.nodeId }
    : edge.target,
  payload: edge.payload ? { ...edge.payload } : undefined,
  updatedAt: now,
}));
