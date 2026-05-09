import type { CanvasNode, GroupNodeData } from '../types';

export const isContainerNode = (node: CanvasNode): boolean =>
  node.type === 'frame' || node.type === 'group';

/** True when a node's center point falls inside a container's bounding box. */
export const isInsideContainer = (node: CanvasNode, container: CanvasNode): boolean => {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  return (
    cx >= container.x &&
    cx <= container.x + container.width &&
    cy >= container.y &&
    cy <= container.y + container.height
  );
};

export const isInsideFrame = isInsideContainer;

const containerArea = (container: CanvasNode) => container.width * container.height;

/**
 * For each node, find its parent container — the smallest (by area) frame/group
 * whose bounding box contains the node's center. Returns a map of nodeId →
 * parent container id (or null for root-level nodes).
 *
 * When `n` is itself a container, a candidate container `f` can only be its
 * parent if `f` is strictly "bigger" than `n` in the total order (area desc,
 * then id asc). This guarantees acyclic parenthood even when two containers
 * share a bbox.
 */
export const computeParentContainerMap = (
  nodes: CanvasNode[]
): Map<string, string | null> => {
  const containers = nodes.filter(isContainerNode);
  const map = new Map<string, string | null>();

  for (const n of nodes) {
    let best: CanvasNode | null = null;
    let bestArea = Infinity;
    let bestIsExplicitGroupChild = false;
    const nArea = isContainerNode(n) ? containerArea(n) : -1;

    for (const f of containers) {
      if (f.id === n.id) continue;
      const groupChildren = f.type === 'group'
        ? (f.data as GroupNodeData).childIds
        : undefined;
      const hasExplicitGroupChildren = Array.isArray(groupChildren);
      const isExplicitGroupChild = hasExplicitGroupChildren && groupChildren.includes(n.id);
      const containsNode = hasExplicitGroupChildren
        ? isExplicitGroupChild
        : isInsideContainer(n, f);
      if (!containsNode) continue;

      const fArea = containerArea(f);
      // For container-in-container, require strict "bigger" ancestor to avoid cycles.
      if (isContainerNode(n)) {
        if (fArea < nArea) continue;
        if (fArea === nArea && f.id >= n.id) continue;
      }

      if (isExplicitGroupChild && !bestIsExplicitGroupChild) {
        best = f;
        bestArea = fArea;
        bestIsExplicitGroupChild = true;
      } else if (isExplicitGroupChild === bestIsExplicitGroupChild && fArea < bestArea) {
        best = f;
        bestArea = fArea;
        bestIsExplicitGroupChild = isExplicitGroupChild;
      } else if (isExplicitGroupChild === bestIsExplicitGroupChild && fArea === bestArea && best && f.id < best.id) {
        best = f;
        bestIsExplicitGroupChild = isExplicitGroupChild;
      }
    }

    map.set(n.id, best ? best.id : null);
  }

  return map;
};

export const computeParentFrameMap = computeParentContainerMap;

/**
 * Collect all transitive descendants of a frame/group (nodes whose parent
 * chain passes through `containerId`). Does NOT include the container itself.
 */
export const collectContainerDescendants = (
  containerId: string,
  nodes: CanvasNode[]
): CanvasNode[] => {
  const parentMap = computeParentContainerMap(nodes);
  const result: CanvasNode[] = [];

  for (const n of nodes) {
    if (n.id === containerId) continue;
    let cur = parentMap.get(n.id) ?? null;
    while (cur) {
      if (cur === containerId) {
        result.push(n);
        break;
      }
      cur = parentMap.get(cur) ?? null;
    }
  }

  return result;
};

export const collectFrameDescendants = collectContainerDescendants;

/**
 * Compute the nesting depth of each container (root containers = 0, container
 * inside a root container = 1, and so on). Non-containers are not included.
 */
export const computeContainerDepths = (nodes: CanvasNode[]): Map<string, number> => {
  const parentMap = computeParentContainerMap(nodes);
  const depths = new Map<string, number>();

  const depthOf = (id: string): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;
    const parent = parentMap.get(id) ?? null;
    const d = parent ? depthOf(parent) + 1 : 0;
    depths.set(id, d);
    return d;
  };

  for (const n of nodes) {
    if (isContainerNode(n)) depthOf(n.id);
  }

  return depths;
};

export const computeFrameDepths = computeContainerDepths;
