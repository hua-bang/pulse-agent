import type { CanvasEdge, CanvasNode } from '../../../types';

export interface ExternalDocumentUpdate {
  currentNodes: CanvasNode[];
  currentEdges: CanvasEdge[];
  diskNodes: CanvasNode[];
  diskEdges: CanvasEdge[];
  changedNodeIds: ReadonlySet<string>;
  changedEdgeIds: ReadonlySet<string>;
  persistedNodeIds: ReadonlySet<string>;
  persistedEdgeIds: ReadonlySet<string>;
}

export interface ExternalDocumentMergeResult {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  createdNodes: CanvasNode[];
}

export interface ExternalDocumentUpdateEvent {
  workspaceId: string;
  nodeIds: string[];
  edgeIds?: string[];
  source: string;
}

export const shouldReloadForExternalUpdate = (event: ExternalDocumentUpdateEvent): boolean => (
  event.nodeIds.length > 0 || (event.edgeIds?.length ?? 0) > 0
);

const mergeExternalEdges = (
  current: CanvasEdge[],
  disk: CanvasEdge[],
  changedIds: ReadonlySet<string>,
  persistedIds: ReadonlySet<string>,
): CanvasEdge[] => {
  if (changedIds.size === 0) return current;
  const diskById = new Map(disk.map(edge => [edge.id, edge]));
  const seen = new Set<string>();
  const next: CanvasEdge[] = [];

  for (const edge of current) {
    seen.add(edge.id);
    if (!changedIds.has(edge.id)) {
      next.push(edge);
      continue;
    }
    const diskEdge = diskById.get(edge.id);
    if (diskEdge) next.push(diskEdge);
    else if (!persistedIds.has(edge.id)) next.push(edge);
  }
  for (const id of changedIds) {
    const diskEdge = diskById.get(id);
    if (!seen.has(id) && diskEdge) next.push(diskEdge);
  }
  return next;
};

export const mergeExternalDocumentUpdate = ({
  currentNodes,
  currentEdges,
  diskNodes,
  diskEdges,
  changedNodeIds,
  changedEdgeIds,
  persistedNodeIds,
  persistedEdgeIds,
}: ExternalDocumentUpdate): ExternalDocumentMergeResult => {
  const diskById = new Map(diskNodes.map(node => [node.id, node]));
  const seen = new Set<string>();
  const nodes: CanvasNode[] = [];

  for (const current of currentNodes) {
    seen.add(current.id);
    if (!changedNodeIds.has(current.id)) {
      nodes.push(current);
      continue;
    }
    const diskNode = diskById.get(current.id);
    if (diskNode) nodes.push(diskNode);
    else if (!persistedNodeIds.has(current.id)) nodes.push(current);
  }

  const createdNodes: CanvasNode[] = [];
  for (const id of changedNodeIds) {
    const diskNode = diskById.get(id);
    if (seen.has(id) || !diskNode) continue;
    nodes.push(diskNode);
    createdNodes.push(diskNode);
  }

  return {
    nodes,
    edges: mergeExternalEdges(currentEdges, diskEdges, changedEdgeIds, persistedEdgeIds),
    createdNodes,
  };
};
