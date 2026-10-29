import type { CanvasNode } from '../../types';
import { DEFAULT_FRAME_PADDING, DEFAULT_LAYOUT_GAP, getBoundingRect, rectOf, type Rect } from './geometry';
import { defaultFrameColumns, layoutGrid } from './grid';
import {
  applyLayoutMutations,
  findParentFrame,
  getFrameChildren,
  planFrameGrid,
  sortByReadingOrder,
  type LayoutMutation,
} from './layout';

/**
 * Preset board layouts. Each preset arranges a set of frames as one design:
 * the cards inside every frame first, then the frames themselves.
 *
 * - `board`: research board. An overview frame spans the top, detail frames
 *   sit in one row below it, and a sources frame runs down the right edge.
 * - `flow`: frames in one left-to-right row, cards stacked in each. Use for
 *   steps, stages, timelines, or kanban columns.
 * - `matrix`: frames in a 2-column grid. Use for 2x2 comparisons, quadrants,
 *   or options side by side.
 * - `stack`: frames stacked top to bottom at one width. Use for a report
 *   that reads in order.
 */
export type LayoutPreset = 'board' | 'flow' | 'matrix' | 'stack';

export interface LayoutPresetOptions {
  preset: LayoutPreset;
  /** Frames in reading order. Omitted means every top-level frame. */
  frameIds?: string[];
  /** board: the frame that spans the top. Defaults to the first frame. */
  overviewFrameId?: string;
  /** board: the frame on the right edge. Optional. */
  sourcesFrameId?: string;
  gap?: number;
  padding?: number;
  startX?: number;
  startY?: number;
}

export interface LayoutPresetPlan {
  mutations: LayoutMutation[];
  frameIds: string[];
  roles: Record<string, 'overview' | 'detail' | 'sources' | 'section'>;
}

/** Frames sit further apart than cards so each frame reads as one region. */
const FRAME_GAP_FACTOR = 2;

export function planLayoutPreset(nodes: CanvasNode[], options: LayoutPresetOptions): LayoutPresetPlan {
  const frames = resolveFrames(nodes, options.frameIds);
  if (frames.length === 0) throw new Error('No frames to lay out');

  const gap = options.gap ?? DEFAULT_LAYOUT_GAP;
  const frameGap = gap * FRAME_GAP_FACTOR;
  const padding = options.padding ?? DEFAULT_FRAME_PADDING;
  const roles = assignRoles(frames, options);

  // Work on a copy, then report every node whose geometry changed.
  const draft = nodes.map((node) => ({ ...node }));
  const draftById = new Map(draft.map((node) => [node.id, node]));
  const childrenByFrame = new Map(frames.map((frame) => [frame.id, getFrameChildren(nodes, frame.id).map((child) => child.id)]));

  for (const frame of frames) {
    const childIds = childrenByFrame.get(frame.id) ?? [];
    if (childIds.length === 0) continue;
    const plan = planFrameGrid(draft, frame.id, {
      nodeIds: childIds,
      columns: innerColumns(options.preset, roles[frame.id], childIds.length, frames.length),
      gap,
      padding,
    });
    applyLayoutMutations(draft, plan.mutations, 0);
  }

  const start = {
    x: options.startX ?? getBoundingRect(frames.map(rectOf))?.x ?? 100,
    y: options.startY ?? getBoundingRect(frames.map(rectOf))?.y ?? 100,
  };
  const ordered = frames.map((frame) => draftById.get(frame.id) as CanvasNode);
  const placements = placeFrames(options.preset, ordered, roles, start, frameGap);

  for (const placement of placements) {
    const frame = draftById.get(placement.id) as CanvasNode;
    const dx = placement.x - frame.x;
    const dy = placement.y - frame.y;
    frame.x = placement.x;
    frame.y = placement.y;
    if (placement.width !== undefined) frame.width = placement.width;
    for (const childId of childrenByFrame.get(frame.id) ?? []) {
      const child = draftById.get(childId);
      if (!child) continue;
      child.x += dx;
      child.y += dy;
    }
  }

  return {
    mutations: diffGeometry(nodes, draftById),
    frameIds: frames.map((frame) => frame.id),
    roles,
  };
}

function resolveFrames(nodes: CanvasNode[], frameIds?: string[]): CanvasNode[] {
  if (frameIds && frameIds.length > 0) {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return [...new Set(frameIds)].map((id) => {
      const node = byId.get(id);
      if (!node || node.type !== 'frame') throw new Error(`Frame not found: ${id}`);
      return node;
    });
  }
  return sortByReadingOrder(nodes.filter((node) => node.type === 'frame' && !findParentFrame(node, nodes)));
}

function assignRoles(frames: CanvasNode[], options: LayoutPresetOptions): LayoutPresetPlan['roles'] {
  const roles: LayoutPresetPlan['roles'] = {};
  if (options.preset !== 'board') {
    for (const frame of frames) roles[frame.id] = 'section';
    return roles;
  }
  const sourcesId = frames.length > 1 ? options.sourcesFrameId : undefined;
  const overviewId = options.overviewFrameId ?? frames.find((frame) => frame.id !== sourcesId)?.id;
  for (const frame of frames) {
    roles[frame.id] = frame.id === overviewId ? 'overview' : frame.id === sourcesId ? 'sources' : 'detail';
  }
  return roles;
}

function innerColumns(preset: LayoutPreset, role: string, count: number, frameCount: number): number {
  switch (preset) {
    case 'board':
      if (role === 'overview') return Math.min(count, 4);
      if (role === 'sources') return 1;
      return frameCount > 4 ? 1 : Math.min(count, 2);
    case 'flow':
      return 1;
    case 'matrix':
      return Math.min(count, 2);
    case 'stack':
    default:
      return defaultFrameColumns(count);
  }
}

interface FramePlacement {
  id: string;
  x: number;
  y: number;
  width?: number;
}

function placeFrames(
  preset: LayoutPreset,
  frames: CanvasNode[],
  roles: LayoutPresetPlan['roles'],
  start: { x: number; y: number },
  gap: number,
): FramePlacement[] {
  if (preset === 'flow') return placeRow(frames, start, gap);
  if (preset === 'matrix') {
    return layoutGrid(frames, start, { columns: Math.min(2, frames.length), gap }).mutations
      .map((mutation) => ({ id: mutation.nodeId, x: mutation.x as number, y: mutation.y as number }));
  }
  if (preset === 'stack') {
    const width = Math.max(...frames.map((frame) => frame.width));
    let y = start.y;
    return frames.map((frame) => {
      const placement = { id: frame.id, x: start.x, y, width };
      y += frame.height + gap;
      return placement;
    });
  }
  return placeBoard(frames, roles, start, gap);
}

function placeRow(frames: CanvasNode[], start: { x: number; y: number }, gap: number): FramePlacement[] {
  let x = start.x;
  return frames.map((frame) => {
    const placement = { id: frame.id, x, y: start.y };
    x += frame.width + gap;
    return placement;
  });
}

function placeBoard(
  frames: CanvasNode[],
  roles: LayoutPresetPlan['roles'],
  start: { x: number; y: number },
  gap: number,
): FramePlacement[] {
  const overview = frames.find((frame) => roles[frame.id] === 'overview');
  const sources = frames.find((frame) => roles[frame.id] === 'sources');
  const details = frames.filter((frame) => roles[frame.id] === 'detail');

  const detailTop = overview ? start.y + overview.height + gap : start.y;
  const detailRow = placeRow(details, { x: start.x, y: detailTop }, gap);
  const detailRect = getBoundingRect(details.map((frame, index) => ({
    ...rectOf(frame),
    x: detailRow[index].x,
    y: detailRow[index].y,
  })));
  const placements: FramePlacement[] = [];
  if (overview) {
    // The overview spans the detail row so the board reads as one block.
    const width = Math.max(overview.width, detailRect?.width ?? 0);
    placements.push({ id: overview.id, x: start.x, y: start.y, width });
  }
  placements.push(...detailRow);
  if (sources) {
    const contentRight = Math.max(
      overview ? start.x + Math.max(overview.width, detailRect?.width ?? 0) : start.x,
      detailRect ? detailRect.x + detailRect.width : start.x,
    );
    placements.push({ id: sources.id, x: contentRight + gap, y: start.y });
  }
  return placements;
}

function diffGeometry(original: CanvasNode[], draftById: Map<string, CanvasNode>): LayoutMutation[] {
  const mutations: LayoutMutation[] = [];
  for (const node of original) {
    const next = draftById.get(node.id);
    if (!next) continue;
    const changed: Partial<Rect> = {};
    if (next.x !== node.x) changed.x = next.x;
    if (next.y !== node.y) changed.y = next.y;
    if (next.width !== node.width) changed.width = next.width;
    if (next.height !== node.height) changed.height = next.height;
    if (Object.keys(changed).length > 0) mutations.push({ nodeId: node.id, ...changed });
  }
  return mutations;
}
