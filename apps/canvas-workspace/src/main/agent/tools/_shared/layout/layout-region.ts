import type { CanvasNode } from '../../types';
import {
  collectFrameDescendantIds,
  findNearestFreeSlot,
  findParentFrame,
  rectOf,
  type LayoutMutation,
  type Rect,
} from './layout';
import { getBoundingRect, rectContainsCenter } from './geometry';
import { layoutGrid } from './grid';

function rootLayoutCandidates(candidates: CanvasNode[], nodes: CanvasNode[]): CanvasNode[] {
  const candidateIds = new Set(candidates.map((node) => node.id));
  return candidates.filter((node) => {
    const parentFrameId = findParentFrame(node, nodes);
    return !parentFrameId || !candidateIds.has(parentFrameId);
  });
}

export function planRegionGrid(
  nodes: CanvasNode[],
  options: {
    nodeIds?: string[];
    region?: Rect;
    columns?: number;
    gap?: number;
    startX?: number;
    startY?: number;
    lockedNodeIds?: string[];
    respectLayoutLocked?: boolean;
  } = {},
): { mutations: LayoutMutation[]; arrangedNodeIds: string[]; skippedNodeIds: string[]; bounds: Rect | null } {
  const requested = options.nodeIds && options.nodeIds.length > 0
    ? new Set(options.nodeIds)
    : null;
  const candidates = requested
    ? nodes.filter((node) => requested.has(node.id))
    : options.region
      ? nodes.filter((node) => rectContainsCenter(options.region!, rectOf(node)))
      : [];

  const locked = new Set(options.lockedNodeIds ?? []);
  const respectLayoutLocked = options.respectLayoutLocked ?? true;
  const roots = rootLayoutCandidates(candidates, nodes);
  const arranging = roots.filter((node) => {
    if (locked.has(node.id)) return false;
    if (respectLayoutLocked && node.data?.layoutLocked === true) return false;
    return true;
  });
  const skippedNodeIds = candidates
    .filter((node) => !arranging.includes(node) && !arranging.some((root) => (
      root.type === 'frame' && collectFrameDescendantIds(root, nodes).has(node.id)
    )))
    .map((node) => node.id);

  const movingIds = new Set<string>();
  for (const node of arranging) {
    movingIds.add(node.id);
    if (node.type === 'frame') {
      for (const childId of collectFrameDescendantIds(node, nodes)) {
        movingIds.add(childId);
      }
    }
  }

  const arrangingBounds = getBoundingRect(arranging.map(rectOf));
  const start = {
    x: options.startX ?? options.region?.x ?? arrangingBounds?.x ?? 100,
    y: options.startY ?? options.region?.y ?? arrangingBounds?.y ?? 100,
  };
  const ideal = layoutGrid(arranging, start, {
    columns: options.columns ?? Math.min(4, Math.ceil(Math.sqrt(Math.max(1, arranging.length)))),
    gap: options.gap,
  });

  const rootsById = new Map(arranging.map((node) => [node.id, node]));
  const idealById = new Map(ideal.mutations.map((mutation) => [mutation.nodeId, mutation]));
  const obstacles = nodes
    .filter((node) => !movingIds.has(node.id))
    .map(rectOf);
  const mutations: LayoutMutation[] = [];

  for (const node of arranging) {
    const preferred = idealById.get(node.id);
    if (preferred?.x === undefined || preferred.y === undefined) continue;
    const placed = findNearestFreeSlot(
      { width: node.width, height: node.height },
      obstacles,
      {
        preferred: { x: preferred.x, y: preferred.y },
        gap: options.gap,
      },
    );
    const dx = placed.x - node.x;
    const dy = placed.y - node.y;
    obstacles.push(placed);
    mutations.push({ nodeId: node.id, x: placed.x, y: placed.y });

    if (node.type === 'frame') {
      for (const childId of collectFrameDescendantIds(node, nodes)) {
        const child = rootsById.has(childId) ? undefined : nodes.find((n) => n.id === childId);
        if (!child || (movingIds.has(child.id) && rootsById.has(child.id))) continue;
        mutations.push({ nodeId: child.id, x: child.x + dx, y: child.y + dy });
      }
    }
  }

  return {
    mutations,
    arrangedNodeIds: arranging.map((node) => node.id),
    skippedNodeIds,
    bounds: ideal.bounds,
  };
}
