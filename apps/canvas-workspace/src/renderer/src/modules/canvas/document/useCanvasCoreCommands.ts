import { useCallback, type MutableRefObject } from 'react';
import type {
  CanvasEdge,
  CanvasNode,
  GroupNodeData,
  TextNodeData,
} from '../../../types';
import { createNodeData, genId } from '../../../utils/nodeFactory';
import { degradeEndpointsForDeletedNode } from '../model/edgeFactory';
import { resizeGroupsToChildren } from '../model/resizeGroupsToChildren';
import type { CanvasDocumentSnapshot } from './CanvasDocumentHistory';

interface CoreCommandOptions {
  nodesRef: MutableRefObject<CanvasNode[]>;
  edgesRef: MutableRefObject<CanvasEdge[]>;
  persistedNodeIdsRef: MutableRefObject<Set<string>>;
  applyNodes: (nodes: CanvasNode[], addToHistory?: boolean) => void;
  applyEdges: (edges: CanvasEdge[], addToHistory?: boolean) => void;
  applyState: (patch: Partial<CanvasDocumentSnapshot>, addToHistory?: boolean) => void;
  replaceState: (snapshot: CanvasDocumentSnapshot) => void;
}

const selectionBounds = (nodes: CanvasNode[]) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }
  return { minX, minY, maxX, maxY };
};

export const useCanvasCoreCommands = ({
  nodesRef,
  edgesRef,
  persistedNodeIdsRef,
  applyNodes,
  applyEdges,
  applyState,
  replaceState,
}: CoreCommandOptions) => {
  const updateNode = useCallback((
    id: string,
    patch: Partial<CanvasNode>,
    options?: { history?: boolean },
  ) => {
    const nodes = nodesRef.current.map(node => node.id === id
      ? { ...node, ...patch, updatedAt: Date.now() }
      : node);
    applyNodes(resizeGroupsToChildren(nodes), options?.history !== false);
  }, [applyNodes, nodesRef]);

  const removeNode = useCallback((id: string) => {
    const victim = nodesRef.current.find(node => node.id === id);
    const nodes = nodesRef.current.filter(node => node.id !== id);
    const edges = victim
      ? degradeEndpointsForDeletedNode(edgesRef.current, victim)
      : edgesRef.current;
    applyState({ nodes: resizeGroupsToChildren(nodes), edges });
  }, [applyState, edgesRef, nodesRef]);

  const removeNodes = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    const victims = nodesRef.current.filter(node => idSet.has(node.id));
    const nodes = nodesRef.current.filter(node => !idSet.has(node.id));
    const edges = victims.reduce(
      (current, victim) => degradeEndpointsForDeletedNode(current, victim),
      edgesRef.current,
    );
    applyState({ nodes: resizeGroupsToChildren(nodes), edges });
  }, [applyState, edgesRef, nodesRef]);

  const syncDeletedNodes = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    ids.forEach(id => persistedNodeIdsRef.current.delete(id));
    replaceState({
      nodes: resizeGroupsToChildren(nodesRef.current.filter(node => !idSet.has(node.id))),
      edges: edgesRef.current.filter(edge => (
        !(edge.source.kind === 'node' && idSet.has(edge.source.nodeId))
        && !(edge.target.kind === 'node' && idSet.has(edge.target.nodeId))
      )),
    });
  }, [edgesRef, nodesRef, persistedNodeIdsRef, replaceState]);

  const ungroupNodes = useCallback((ids: string[]): string[] => {
    if (ids.length === 0) return [];
    const idSet = new Set(ids);
    const groups = nodesRef.current.filter(node => idSet.has(node.id) && node.type === 'group');
    if (groups.length === 0) return [];
    const now = Date.now();
    const groupIds = new Set(groups.map(group => group.id));
    const groupChildIds = new Map(groups.map(group => [
      group.id,
      Array.isArray((group.data as GroupNodeData).childIds)
        ? (group.data as GroupNodeData).childIds ?? []
        : [],
    ] as const));
    const existingIds = new Set(nodesRef.current.map(node => node.id));
    const promotedIds = new Set<string>();
    const nodes = nodesRef.current
      .filter(node => !groupIds.has(node.id))
      .map((node) => {
        if (node.type !== 'group') return node;
        const data = node.data as GroupNodeData;
        const childIds = Array.isArray(data.childIds) ? data.childIds : [];
        if (childIds.length === 0) return node;
        const nextChildIds: string[] = [];
        let changed = false;
        for (const childId of childIds) {
          if (!groupIds.has(childId)) {
            nextChildIds.push(childId);
            continue;
          }
          changed = true;
          for (const promotedId of groupChildIds.get(childId) ?? []) {
            if (groupIds.has(promotedId) || !existingIds.has(promotedId)) continue;
            if (!nextChildIds.includes(promotedId)) nextChildIds.push(promotedId);
            promotedIds.add(promotedId);
          }
        }
        return changed
          ? { ...node, data: { ...data, childIds: nextChildIds }, updatedAt: now }
          : node;
      });
    for (const childIds of groupChildIds.values()) {
      for (const childId of childIds) {
        if (!groupIds.has(childId) && existingIds.has(childId)) promotedIds.add(childId);
      }
    }
    const edges = groups.reduce(
      (current, group) => degradeEndpointsForDeletedNode(current, group),
      edgesRef.current,
    );
    applyState({ nodes: resizeGroupsToChildren(nodes), edges });
    return [...promotedIds];
  }, [applyState, edgesRef, nodesRef]);

  const moveNode = useCallback((id: string, x: number, y: number) => {
    const nodes = nodesRef.current.map(node => node.id === id
      ? { ...node, x, y, updatedAt: Date.now() }
      : node);
    applyNodes(resizeGroupsToChildren(nodes), false);
  }, [applyNodes, nodesRef]);

  const moveNodes = useCallback((moves: Array<{ id: string; x: number; y: number }>) => {
    const now = Date.now();
    const moveById = new Map(moves.map(move => [move.id, move]));
    const nodes = nodesRef.current.map((node) => {
      const move = moveById.get(node.id);
      return move ? { ...node, x: move.x, y: move.y, updatedAt: now } : node;
    });
    applyNodes(resizeGroupsToChildren(nodes), false);
  }, [applyNodes, nodesRef]);

  const resizeNode = useCallback((
    id: string,
    width: number,
    height: number,
    x?: number,
    y?: number,
    options?: { disableTextAutoSize?: boolean },
  ) => {
    const nodes = nodesRef.current.map((node) => {
      if (node.id !== id) return node;
      const data = options?.disableTextAutoSize && node.type === 'text'
        ? { ...(node.data as TextNodeData), autoSize: false }
        : node.data;
      return { ...node, width, height, x: x ?? node.x, y: y ?? node.y, data, updatedAt: Date.now() };
    });
    applyNodes(resizeGroupsToChildren(nodes), false);
  }, [applyNodes, nodesRef]);

  const groupNodes = useCallback((ids: string[]): CanvasNode | null => {
    const idSet = new Set(ids);
    const targets = nodesRef.current.filter(node => idSet.has(node.id));
    if (targets.length === 0) return null;
    const bounds = selectionBounds(targets);
    const padding = 18;
    const group: CanvasNode = {
      id: genId(),
      type: 'group',
      title: 'Group',
      x: bounds.minX - padding,
      y: bounds.minY - padding,
      width: bounds.maxX - bounds.minX + padding * 2,
      height: bounds.maxY - bounds.minY + padding * 2,
      data: { ...(createNodeData('group') as GroupNodeData), childIds: targets.map(node => node.id) },
      updatedAt: Date.now(),
    };
    applyNodes(resizeGroupsToChildren([...nodesRef.current, group]));
    return group;
  }, [applyNodes, nodesRef]);

  const wrapNodesInFrame = useCallback((ids: string[]): CanvasNode | null => {
    const idSet = new Set(ids);
    const targets = nodesRef.current.filter(node => idSet.has(node.id));
    if (targets.length === 0) return null;
    const bounds = selectionBounds(targets);
    const padding = { x: 40, top: 72, bottom: 40 };
    const frame: CanvasNode = {
      id: genId(),
      type: 'frame',
      title: 'Frame',
      x: bounds.minX - padding.x,
      y: bounds.minY - padding.top,
      width: bounds.maxX - bounds.minX + padding.x * 2,
      height: bounds.maxY - bounds.minY + padding.top + padding.bottom,
      data: createNodeData('frame'),
      updatedAt: Date.now(),
    };
    applyNodes(resizeGroupsToChildren([...nodesRef.current, frame]));
    return frame;
  }, [applyNodes, nodesRef]);

  const addEdge = useCallback((edge: CanvasEdge) => {
    applyEdges([...edgesRef.current, edge]);
    return edge;
  }, [applyEdges, edgesRef]);

  const updateEdge = useCallback((id: string, patch: Partial<CanvasEdge>, addToHistory = true) => {
    applyEdges(edgesRef.current.map(edge => edge.id === id
      ? { ...edge, ...patch, updatedAt: Date.now() }
      : edge), addToHistory);
  }, [applyEdges, edgesRef]);

  const removeEdge = useCallback((id: string) => {
    applyEdges(edgesRef.current.filter(edge => edge.id !== id));
  }, [applyEdges, edgesRef]);

  const removeEdges = useCallback((ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    applyEdges(edgesRef.current.filter(edge => !idSet.has(edge.id)));
  }, [applyEdges, edgesRef]);

  return {
    updateNode,
    removeNode,
    removeNodes,
    syncDeletedNodes,
    ungroupNodes,
    moveNode,
    moveNodes,
    resizeNode,
    groupNodes,
    wrapNodesInFrame,
    addEdge,
    updateEdge,
    removeEdge,
    removeEdges,
  };
};
