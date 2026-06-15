import { useEffect, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { CanvasEdge, CanvasNode } from '../../../types';
import {
  collectCollapsedFrameDescendantIds,
  filterCollapsedFrameDescendants,
} from '../../../utils/frameHierarchy';

const isEdgeEndpointVisible = (
  endpoint: CanvasEdge['source'],
  visibleNodeIds: Set<string>,
): boolean => endpoint.kind === 'point' || visibleNodeIds.has(endpoint.nodeId);

const isEdgeVisible = (
  edge: CanvasEdge,
  visibleNodeIds: Set<string>,
): boolean =>
  isEdgeEndpointVisible(edge.source, visibleNodeIds) &&
  isEdgeEndpointVisible(edge.target, visibleNodeIds);

interface Options {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedEdgeId: string | null;
  setSelectedEdgeId: Dispatch<SetStateAction<string | null>>;
  setSelectedNodeIds: Dispatch<SetStateAction<string[]>>;
}

export const useCanvasVisibility = ({
  nodes,
  edges,
  selectedEdgeId,
  setSelectedEdgeId,
  setSelectedNodeIds,
}: Options) => {
  const collapsedFrameHiddenNodeIds = useMemo(
    () => collectCollapsedFrameDescendantIds(nodes),
    [nodes],
  );

  const visibleNodes = useMemo(
    () => filterCollapsedFrameDescendants(nodes),
    [nodes],
  );

  const visibleNodeIds = useMemo(
    () => new Set(visibleNodes.map((node) => node.id)),
    [visibleNodes],
  );

  const visibleNodesById = useMemo(() => {
    const m = new Map<string, CanvasNode>();
    for (const n of visibleNodes) m.set(n.id, n);
    return m;
  }, [visibleNodes]);

  const visibleEdges = useMemo(
    () => edges.filter((edge) => isEdgeVisible(edge, visibleNodeIds)),
    [edges, visibleNodeIds],
  );

  useEffect(() => {
    if (collapsedFrameHiddenNodeIds.size === 0) return;
    setSelectedNodeIds((current) => {
      const next = current.filter((id) => !collapsedFrameHiddenNodeIds.has(id));
      return next.length === current.length ? current : next;
    });
  }, [collapsedFrameHiddenNodeIds, setSelectedNodeIds]);

  useEffect(() => {
    if (!selectedEdgeId) return;
    if (!visibleEdges.some((edge) => edge.id === selectedEdgeId)) {
      setSelectedEdgeId(null);
    }
  }, [selectedEdgeId, setSelectedEdgeId, visibleEdges]);

  return {
    visibleNodes,
    visibleNodeIds,
    visibleNodesById,
    visibleEdges,
  };
};
