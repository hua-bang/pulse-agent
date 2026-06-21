import type { CanvasNode } from '../types';
import { alignToGrid, bottom, centerX, centerY, clampSize, DEFAULT_FRAME_PADDING, DEFAULT_GRID, DEFAULT_LAYOUT_GAP, getBoundingRect, MIN_NODE_SIZE, overlapArea, rectContainsCenter, rectContainsRect, rectOf, rectsOverlap, right, type Rect } from './geometry';

export { DEFAULT_FRAME_PADDING, DEFAULT_GRID, DEFAULT_LAYOUT_GAP, MIN_NODE_SIZE, rectOf, rectsOverlap };
export type { Rect };

export type LayoutDirection = 'right' | 'below' | 'left' | 'above';

export interface LayoutMutation {
  nodeId: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

export interface LayoutSnapshotNode {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  parentFrameId?: string;
}

export interface LayoutSnapshot {
  bounds: Rect | null;
  nodes: LayoutSnapshotNode[];
  frames: Array<{
    id: string;
    title: string;
    x: number;
    y: number;
    width: number;
    height: number;
    childIds: string[];
  }>;
  overlaps: Array<{
    a: string;
    b: string;
    area: number;
  }>;
}

const MAX_SEARCH_RADIUS = 2400;

export function getCanvasBounds(nodes: CanvasNode[]): Rect | null {
  if (nodes.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const rect = rectOf(node);
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, right(rect));
    maxY = Math.max(maxY, bottom(rect));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function getFrameChildren(
  nodes: CanvasNode[],
  frameId: string,
  explicitNodeIds?: string[],
): CanvasNode[] {
  const frame = nodes.find((node) => node.id === frameId);
  if (!frame || frame.type !== 'frame') return [];

  if (explicitNodeIds && explicitNodeIds.length > 0) {
    const requested = new Set(explicitNodeIds.filter((id) => id !== frameId));
    return nodes.filter((node) => requested.has(node.id));
  }

  const frameRect = rectOf(frame);
  return nodes.filter((node) => {
    if (node.id === frameId) return false;
    if (node.type === 'frame') return false;
    return rectContainsCenter(frameRect, rectOf(node));
  });
}

export function findParentFrame(node: CanvasNode, nodes: CanvasNode[]): string | undefined {
  if (node.type === 'frame') return undefined;
  const rect = rectOf(node);
  const containingFrames = nodes
    .filter((candidate) => candidate.type === 'frame' && candidate.id !== node.id)
    .filter((candidate) => rectContainsCenter(rectOf(candidate), rect))
    .sort((a, b) => a.width * a.height - b.width * b.height);
  return containingFrames[0]?.id;
}

export function buildLayoutSnapshot(nodes: CanvasNode[], gap = 0): LayoutSnapshot {
  const parentFrameByNode = new Map<string, string>();
  for (const node of nodes) {
    const parentFrameId = findParentFrame(node, nodes);
    if (parentFrameId) parentFrameByNode.set(node.id, parentFrameId);
  }

  const frames = nodes
    .filter((node) => node.type === 'frame')
    .map((frame) => ({
      id: frame.id,
      title: frame.title,
      ...rectOf(frame),
      childIds: nodes
        .filter((node) => parentFrameByNode.get(node.id) === frame.id)
        .map((node) => node.id),
    }));

  const overlaps: LayoutSnapshot['overlaps'] = [];
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      const aParent = parentFrameByNode.get(a.id);
      const bParent = parentFrameByNode.get(b.id);
      if (a.type === 'frame' && bParent === a.id) continue;
      if (b.type === 'frame' && aParent === b.id) continue;
      const aRect = rectOf(a);
      const bRect = rectOf(b);
      if (!rectsOverlap(aRect, bRect, gap)) continue;
      overlaps.push({
        a: a.id,
        b: b.id,
        area: Math.round(overlapArea(aRect, bRect)),
      });
    }
  }

  return {
    bounds: getCanvasBounds(nodes),
    nodes: nodes.map((node) => {
      const rect = rectOf(node);
      return {
        id: node.id,
        type: node.type,
        title: node.title,
        ...rect,
        centerX: Math.round(centerX(rect)),
        centerY: Math.round(centerY(rect)),
        parentFrameId: parentFrameByNode.get(node.id),
      };
    }),
    frames,
    overlaps,
  };
}

function layoutGrid(
  nodes: CanvasNode[],
  start: { x: number; y: number },
  options: { columns?: number; gap?: number },
): { mutations: LayoutMutation[]; bounds: Rect | null } {
  const gap = options.gap ?? DEFAULT_LAYOUT_GAP;
  const columns = Math.max(
    1,
    Math.min(options.columns ?? Math.ceil(Math.sqrt(Math.max(1, nodes.length))), Math.max(1, nodes.length)),
  );
  const mutations: LayoutMutation[] = [];
  const rects: Rect[] = [];
  let cursorX = start.x;
  let cursorY = start.y;
  let rowHeight = 0;
  let col = 0;

  for (const node of nodes) {
    if (col >= columns) {
      cursorX = start.x;
      cursorY += rowHeight + gap;
      rowHeight = 0;
      col = 0;
    }

    const rect = {
      x: cursorX,
      y: cursorY,
      width: clampSize(node.width),
      height: clampSize(node.height),
    };
    mutations.push({ nodeId: node.id, x: rect.x, y: rect.y });
    rects.push(rect);
    cursorX += rect.width + gap;
    rowHeight = Math.max(rowHeight, rect.height);
    col += 1;
  }

  return { mutations, bounds: getBoundingRect(rects) };
}

function frameInnerRect(frame: CanvasNode, padding: number): Rect {
  return {
    x: frame.x + padding,
    y: frame.y + padding,
    width: Math.max(MIN_NODE_SIZE, frame.width - padding * 2),
    height: Math.max(MIN_NODE_SIZE, frame.height - padding * 2),
  };
}

export function planFrameGrid(
  nodes: CanvasNode[],
  frameId: string,
  options: {
    nodeIds?: string[];
    columns?: number;
    gap?: number;
    padding?: number;
    fitFrame?: boolean;
  } = {},
): { mutations: LayoutMutation[]; childIds: string[]; bounds: Rect | null } {
  const frame = nodes.find((node) => node.id === frameId);
  if (!frame || frame.type !== 'frame') {
    throw new Error(`Frame not found: ${frameId}`);
  }

  const padding = options.padding ?? DEFAULT_FRAME_PADDING;
  const fitFrame = options.fitFrame ?? true;
  const children = getFrameChildren(nodes, frameId, options.nodeIds);
  const inner = frameInnerRect(frame, padding);
  const laidOut = layoutGrid(children, { x: inner.x, y: inner.y }, {
    columns: options.columns ?? (children.length <= 3 ? children.length || 1 : 2),
    gap: options.gap,
  });
  const mutations = [...laidOut.mutations];

  if (fitFrame && laidOut.bounds) {
    mutations.push({
      nodeId: frame.id,
      width: laidOut.bounds.width + padding * 2,
      height: laidOut.bounds.height + padding * 2,
    });
  }

  return {
    mutations,
    childIds: children.map((node) => node.id),
    bounds: laidOut.bounds,
  };
}

function preferredPositionForDirection(anchor: Rect, size: { width: number; height: number }, direction: LayoutDirection, gap: number): { x: number; y: number } {
  switch (direction) {
    case 'left':
      return { x: anchor.x - size.width - gap, y: anchor.y };
    case 'above':
      return { x: anchor.x, y: anchor.y - size.height - gap };
    case 'below':
      return { x: anchor.x, y: bottom(anchor) + gap };
    case 'right':
    default:
      return { x: right(anchor) + gap, y: anchor.y };
  }
}

function fitsContainer(rect: Rect, container?: Rect): boolean {
  if (!container) return true;
  return rectContainsRect(container, rect);
}

function collides(rect: Rect, obstacles: Rect[], gap: number): boolean {
  return obstacles.some((obstacle) => rectsOverlap(rect, obstacle, gap));
}

export function findNearestFreeSlot(
  size: { width: number; height: number },
  obstacles: Rect[],
  options: {
    preferred: { x: number; y: number };
    gap?: number;
    grid?: number;
    container?: Rect;
  },
): Rect {
  const gap = options.gap ?? DEFAULT_LAYOUT_GAP;
  const grid = options.grid ?? DEFAULT_GRID;
  const base = {
    x: alignToGrid(options.preferred.x, grid),
    y: alignToGrid(options.preferred.y, grid),
  };
  const width = clampSize(size.width);
  const height = clampSize(size.height);

  for (let radius = 0; radius <= MAX_SEARCH_RADIUS; radius += grid) {
    const candidates: Array<{ x: number; y: number }> = [];
    if (radius === 0) {
      candidates.push(base);
    } else {
      for (let dx = -radius; dx <= radius; dx += grid) {
        candidates.push({ x: base.x + dx, y: base.y - radius });
        candidates.push({ x: base.x + dx, y: base.y + radius });
      }
      for (let dy = -radius + grid; dy <= radius - grid; dy += grid) {
        candidates.push({ x: base.x - radius, y: base.y + dy });
        candidates.push({ x: base.x + radius, y: base.y + dy });
      }
      candidates.sort((a, b) => {
        const da = (a.x - base.x) ** 2 + (a.y - base.y) ** 2;
        const db = (b.x - base.x) ** 2 + (b.y - base.y) ** 2;
        return da - db || a.y - b.y || a.x - b.x;
      });
    }

    for (const candidate of candidates) {
      const rect = { ...candidate, width, height };
      if (!fitsContainer(rect, options.container)) continue;
      if (collides(rect, obstacles, gap)) continue;
      return rect;
    }
  }

  throw new Error('Could not find a free layout slot near the requested position');
}

export function planPlaceNear(
  nodes: CanvasNode[],
  nodeIds: string[],
  options: {
    anchorNodeId?: string;
    direction?: LayoutDirection;
    gap?: number;
    grid?: number;
  } = {},
): { mutations: LayoutMutation[] } {
  const requested = new Set(nodeIds);
  const moving = nodes.filter((node) => requested.has(node.id));
  if (moving.length === 0) throw new Error('No target nodes found to place');

  const gap = options.gap ?? DEFAULT_LAYOUT_GAP;
  const direction = options.direction ?? 'right';
  const anchor = options.anchorNodeId
    ? nodes.find((node) => node.id === options.anchorNodeId)
    : undefined;
  const bounds = getCanvasBounds(nodes);
  let lastAnchor = anchor
    ? rectOf(anchor)
    : bounds
      ? { x: right(bounds), y: bounds.y, width: 0, height: 0 }
      : { x: 100, y: 100, width: 0, height: 0 };
  const obstacles = nodes
    .filter((node) => !requested.has(node.id))
    .map(rectOf);
  const mutations: LayoutMutation[] = [];

  for (const node of moving) {
    const size = { width: node.width, height: node.height };
    const preferred = preferredPositionForDirection(lastAnchor, size, direction, gap);
    const placed = findNearestFreeSlot(size, obstacles, {
      preferred,
      gap,
      grid: options.grid,
    });
    obstacles.push(placed);
    mutations.push({ nodeId: node.id, x: placed.x, y: placed.y });
    lastAnchor = placed;
  }

  return { mutations };
}

export function collectFrameDescendantIds(frame: CanvasNode, nodes: CanvasNode[]): Set<string> {
  const descendants = new Set<string>();
  const frameRect = rectOf(frame);
  for (const node of nodes) {
    if (node.id === frame.id) continue;
    if (rectContainsCenter(frameRect, rectOf(node))) {
      descendants.add(node.id);
    }
  }
  return descendants;
}

function defaultTopLevelNodes(nodes: CanvasNode[]): CanvasNode[] {
  const parented = new Set<string>();
  for (const node of nodes) {
    const parentFrameId = findParentFrame(node, nodes);
    if (parentFrameId) parented.add(node.id);
  }
  return nodes.filter((node) => !parented.has(node.id));
}

export function planCanvasGrid(
  nodes: CanvasNode[],
  options: {
    nodeIds?: string[];
    columns?: number;
    gap?: number;
    startX?: number;
    startY?: number;
    lockedNodeIds?: string[];
    respectLayoutLocked?: boolean;
  } = {},
): { mutations: LayoutMutation[]; skippedNodeIds: string[] } {
  const requested = options.nodeIds && options.nodeIds.length > 0
    ? new Set(options.nodeIds)
    : null;
  const locked = new Set(options.lockedNodeIds ?? []);
  const respectLayoutLocked = options.respectLayoutLocked ?? true;
  const candidates = requested
    ? nodes.filter((node) => requested.has(node.id))
    : defaultTopLevelNodes(nodes);
  const topLevel = candidates.filter((node) => {
    if (locked.has(node.id)) return false;
    if (respectLayoutLocked && node.data?.layoutLocked === true) return false;
    return true;
  });
  const skippedNodeIds = candidates
    .filter((node) => !topLevel.includes(node))
    .map((node) => node.id);

  const movingIds = new Set<string>();
  for (const node of topLevel) {
    movingIds.add(node.id);
    if (node.type === 'frame') {
      for (const childId of collectFrameDescendantIds(node, nodes)) {
        movingIds.add(childId);
      }
    }
  }

  const bounds = getCanvasBounds(nodes);
  const start = {
    x: options.startX ?? bounds?.x ?? 100,
    y: options.startY ?? bounds?.y ?? 100,
  };
  const ideal = layoutGrid(topLevel, start, {
    columns: options.columns ?? Math.min(4, Math.ceil(Math.sqrt(Math.max(1, topLevel.length)))),
    gap: options.gap,
  });

  const topById = new Map(topLevel.map((node) => [node.id, node]));
  const idealById = new Map(ideal.mutations.map((mutation) => [mutation.nodeId, mutation]));
  const obstacles = nodes
    .filter((node) => !movingIds.has(node.id))
    .map(rectOf);
  const mutations: LayoutMutation[] = [];

  for (const node of topLevel) {
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
        const child = topById.has(childId) ? undefined : nodes.find((n) => n.id === childId);
        if (!child || movingIds.has(child.id) && topById.has(child.id)) continue;
        mutations.push({ nodeId: child.id, x: child.x + dx, y: child.y + dy });
      }
    }
  }

  return { mutations, skippedNodeIds };
}

export function applyLayoutMutations(
  nodes: CanvasNode[],
  mutations: LayoutMutation[],
  now = Date.now(),
): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const changed = new Set<string>();
  for (const mutation of mutations) {
    const node = byId.get(mutation.nodeId);
    if (!node) continue;
    if (mutation.x !== undefined) node.x = Math.round(mutation.x);
    if (mutation.y !== undefined) node.y = Math.round(mutation.y);
    if (mutation.width !== undefined) node.width = Math.round(clampSize(mutation.width));
    if (mutation.height !== undefined) node.height = Math.round(clampSize(mutation.height));
    node.updatedAt = now;
    changed.add(node.id);
  }
  return [...changed];
}
