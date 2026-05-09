import type { CanvasNode } from '../../../types';
import { computeParentContainerMap, isContainerNode } from '../../../utils/frameHierarchy';

export interface LayerTreeNode {
  node: CanvasNode;
  children: LayerTreeNode[];
}

/**
 * Build a recursive tree. Each node is nested under its most-specific
 * containing frame/group (see `computeParentContainerMap`). Containers may
 * contain both regular nodes and other containers.
 */
export const buildLayerTree = (nodes: CanvasNode[]): LayerTreeNode[] => {
  const parentMap = computeParentContainerMap(nodes);
  const byId = new Map(nodes.map((n) => [n.id, n] as const));

  // Preserve the input ordering by walking `nodes` when grouping children.
  const childrenOf = new Map<string | null, string[]>();
  for (const n of nodes) {
    const key = parentMap.get(n.id) ?? null;
    const arr = childrenOf.get(key);
    if (arr) arr.push(n.id);
    else childrenOf.set(key, [n.id]);
  }

  const buildNode = (id: string): LayerTreeNode => {
    const node = byId.get(id)!;
    const childIds = childrenOf.get(id) ?? [];
    return { node, children: childIds.map(buildNode) };
  };

  const rootIds = childrenOf.get(null) ?? [];
  return rootIds.map(buildNode);
};

/** Walk a layer tree and collect every container id (including nested containers). */
export const collectFrameIds = (tree: LayerTreeNode[]): string[] => {
  const out: string[] = [];
  const walk = (nodes: LayerTreeNode[]) => {
    for (const n of nodes) {
      if (isContainerNode(n.node)) out.push(n.node.id);
      if (n.children.length > 0) walk(n.children);
    }
  };
  walk(tree);
  return out;
};
