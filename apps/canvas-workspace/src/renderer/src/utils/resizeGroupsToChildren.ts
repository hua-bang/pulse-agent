import type { CanvasNode, GroupNodeData } from '../types';

const PADDING = 18;

/**
 * Grow/shrink every `group` node so it wraps its children with padding.
 * Nested groups converge across up to 4 passes; each pass returns the same
 * array identity when nothing changed so callers can cheaply detect no-ops.
 */
export const resizeGroupsToChildren = (nextNodes: CanvasNode[]): CanvasNode[] => {
  // Runs on every node mutation (move/resize/add) — skip the Map+map
  // passes entirely on the common group-less canvas.
  if (!nextNodes.some((node) => node.type === 'group')) return nextNodes;

  let current = nextNodes;

  for (let pass = 0; pass < 4; pass += 1) {
    const byId = new Map(current.map((node) => [node.id, node] as const));
    let changed = false;

    const resized = current.map((node) => {
      if (node.type !== 'group') return node;
      const data = node.data as GroupNodeData;
      const childIds = Array.isArray(data.childIds) ? data.childIds : [];
      const children = childIds
        .map((id) => byId.get(id))
        .filter((child): child is CanvasNode => !!child && child.id !== node.id);
      if (children.length === 0) return node;

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const child of children) {
        minX = Math.min(minX, child.x);
        minY = Math.min(minY, child.y);
        maxX = Math.max(maxX, child.x + child.width);
        maxY = Math.max(maxY, child.y + child.height);
      }

      const next = {
        ...node,
        x: minX - PADDING,
        y: minY - PADDING,
        width: maxX - minX + PADDING * 2,
        height: maxY - minY + PADDING * 2,
        updatedAt: Date.now(),
      };
      if (
        next.x === node.x &&
        next.y === node.y &&
        next.width === node.width &&
        next.height === node.height
      ) {
        return node;
      }
      changed = true;
      return next;
    });

    if (!changed) return current;
    current = resized;
  }

  return current;
};
