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

const getGroupChildIds = (node: CanvasNode): string[] | null => {
  if (node.type !== 'group') return null;
  const childIds = (node.data as GroupNodeData).childIds;
  return Array.isArray(childIds) ? childIds : null;
};

const isExplicitGroupChild = (node: CanvasNode, group: CanvasNode): boolean => {
  const childIds = getGroupChildIds(group);
  return !!childIds?.includes(node.id);
};

const isCandidateParent = (node: CanvasNode, container: CanvasNode): boolean => {
  const explicitGroupChild = isExplicitGroupChild(node, container);
  if (explicitGroupChild) return true;

  const groupChildIds = getGroupChildIds(container);
  if (groupChildIds) {
    // Groups with explicit childIds intentionally own only listed regular
    // nodes, but still allow spatial nesting of other containers. This keeps
    // a group placed inside another group attached even when it was not part
    // of the original childIds set.
    return isContainerNode(node) && isInsideContainer(node, container);
  }

  return isInsideContainer(node, container);
};

/**
 * For each node, find its parent container — the smallest (by area) frame/group
 * whose bounding box contains the node's center. Returns a map of nodeId →
 * parent container id (or null for root-level nodes).
 *
 * Group childIds are treated as directed parenthood and win over purely spatial
 * containment. For container-in-container nesting, spatial candidates still use
 * a strict area/id ordering to avoid cycles; explicit group membership is
 * allowed even when two group boxes have the same size, which is common after
 * wrapping an existing group in another group.
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
      const explicitGroupChild = isExplicitGroupChild(n, f);
      if (!isCandidateParent(n, f)) continue;

      const fArea = containerArea(f);
      // For spatial container-in-container, require strict "bigger" ancestor
      // to avoid cycles. Explicit group membership is directed data, so allow
      // it even when the wrapper resized to the same bbox as the child group.
      if (isContainerNode(n) && !explicitGroupChild) {
        if (fArea < nArea) continue;
        if (fArea === nArea && f.id >= n.id) continue;
      }

      if (explicitGroupChild && !bestIsExplicitGroupChild) {
        best = f;
        bestArea = fArea;
        bestIsExplicitGroupChild = true;
      } else if (explicitGroupChild === bestIsExplicitGroupChild && fArea < bestArea) {
        best = f;
        bestArea = fArea;
        bestIsExplicitGroupChild = explicitGroupChild;
      } else if (explicitGroupChild === bestIsExplicitGroupChild && fArea === bestArea && best && f.id < best.id) {
        best = f;
        bestIsExplicitGroupChild = explicitGroupChild;
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
