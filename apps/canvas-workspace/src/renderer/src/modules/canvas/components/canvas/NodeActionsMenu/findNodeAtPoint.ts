import type { CanvasNode } from '../../../../../types';

/**
 * The node under a canvas point. Containers sit behind their children, so
 * the smallest node that holds the point is the one the user sees on top.
 *
 * Kept out of the menu module so a right-click can hit-test without loading
 * the menu chunk.
 */
export const findNodeAtPoint = (
  nodes: readonly CanvasNode[],
  point: { x: number; y: number },
): CanvasNode | undefined => {
  let hit: CanvasNode | undefined;
  for (const node of nodes) {
    const inside = point.x >= node.x && point.x <= node.x + node.width
      && point.y >= node.y && point.y <= node.y + node.height;
    if (inside && (!hit || node.width * node.height < hit.width * hit.height)) hit = node;
  }
  return hit;
};
