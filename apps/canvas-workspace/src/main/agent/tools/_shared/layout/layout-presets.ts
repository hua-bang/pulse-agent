import type { CanvasNode } from '../../types';
import { DEFAULT_FRAME_PADDING, DEFAULT_LAYOUT_GAP, getBoundingRect, rectOf, type Rect } from './geometry';
import { defaultFrameColumns } from './grid';
import { placeCells, placeMasonry, type FrameBox, type FrameCell } from './frame-cells';
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
 * the cards inside every frame first, then the frames themselves. Frames that
 * share a column get one width and, in the row-based designs (board, flow,
 * matrix), frames that share a row get one height. Cards widen to fill a
 * frame that was stretched.
 *
 * - `board`: research board. An overview frame spans the top, detail frames
 *   sit in one row below it, and a sources frame runs down the right edge.
 * - `flow`: frames in one left-to-right row, cards stacked in each. Use for
 *   steps, stages, timelines, or kanban columns.
 * - `matrix`: frames in a 2-column grid. Use for 2x2 comparisons, quadrants,
 *   or options side by side.
 * - `stack`: frames stacked top to bottom at one width. Use for a report
 *   that reads in order.
 * - `hub`: a central frame with the other frames around it (top, right,
 *   bottom, left, then the corners), each centered on its side. Use for one
 *   topic and its facets.
 * - `spotlight`: a large lead frame on the left and the other frames in a
 *   column on the right. Use for one main finding with supporting points.
 * - `masonry`: frames packed into even-width columns, each frame in the
 *   shortest column. Use for many loosely related frames, such as a
 *   collection or a mood board.
 */
export type LayoutPreset = 'board' | 'flow' | 'matrix' | 'stack' | 'hub' | 'spotlight' | 'masonry';

export interface LayoutPresetOptions {
  preset: LayoutPreset;
  /** Frames in reading order. Omitted means every top-level frame. */
  frameIds?: string[];
  /** board, hub, spotlight: the main frame. Defaults to the first frame. */
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
/** Cards widen to fill a stretched frame up to the note editor's text width. */
const MAX_FILLED_CARD_WIDTH = 800;
/** Hub spokes in order: top, right, bottom, left, then the corners. */
const HUB_CELLS = [[1, 0], [2, 1], [1, 2], [0, 1], [0, 0], [2, 0], [2, 2], [0, 2]];
const PRESETS_WITH_OVERVIEW = new Set<LayoutPreset>(['board', 'hub', 'spotlight']);

type Roles = LayoutPresetPlan['roles'];

export function planLayoutPreset(nodes: CanvasNode[], options: LayoutPresetOptions): LayoutPresetPlan {
  const frames = resolveFrames(nodes, options.frameIds);
  if (frames.length === 0) throw new Error('No frames to lay out');

  const gap = options.gap ?? DEFAULT_LAYOUT_GAP;
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

  const bounds = getBoundingRect(frames.map(rectOf));
  const start = { x: options.startX ?? bounds?.x ?? 100, y: options.startY ?? bounds?.y ?? 100 };
  const fitted = frames.map((frame) => draftById.get(frame.id) as CanvasNode);
  const boxes = placeFrames(options.preset, fitted, roles, start, gap * FRAME_GAP_FACTOR);

  for (const box of boxes) {
    const frame = draftById.get(box.id) as CanvasNode;
    const children = (childrenByFrame.get(frame.id) ?? []).map((id) => draftById.get(id)).filter((child): child is CanvasNode => !!child);
    const dx = box.x - frame.x;
    const dy = box.y - frame.y;
    for (const child of children) {
      child.x += dx;
      child.y += dy;
    }
    Object.assign(frame, { x: box.x, y: box.y, width: box.width, height: box.height });
    fillFrameWidth(frame, children, padding, gap);
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

function assignRoles(frames: CanvasNode[], options: LayoutPresetOptions): Roles {
  const roles: Roles = {};
  if (!PRESETS_WITH_OVERVIEW.has(options.preset)) {
    for (const frame of frames) roles[frame.id] = 'section';
    return roles;
  }
  const sourcesId = options.preset === 'board' && frames.length > 1 ? options.sourcesFrameId : undefined;
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
    case 'masonry':
      return 1;
    case 'matrix':
    case 'spotlight':
      return Math.min(count, 2);
    case 'hub':
      return role === 'overview' ? Math.min(count, 2) : 1;
    case 'stack':
    default:
      return defaultFrameColumns(count);
  }
}

function placeFrames(
  preset: LayoutPreset,
  frames: CanvasNode[],
  roles: Roles,
  start: { x: number; y: number },
  gap: number,
): FrameBox[] {
  const cell = (frame: CanvasNode, col: number, row: number, span: Partial<FrameCell> = {}): FrameCell => ({
    id: frame.id,
    width: frame.width,
    height: frame.height,
    col,
    row,
    ...span,
  });
  const main = frames.find((frame) => roles[frame.id] === 'overview');
  const others = frames.filter((frame) => frame !== main);

  switch (preset) {
    case 'flow':
      return placeCells(frames.map((frame, index) => cell(frame, index, 0)), start, gap);
    case 'stack':
      return placeCells(frames.map((frame, index) => cell(frame, 0, index)), start, gap);
    case 'matrix':
      return placeCells(frames.map((frame, index) => cell(frame, index % 2, Math.floor(index / 2))), start, gap);
    case 'masonry':
      return placeMasonry(frames, frames.length <= 4 ? 2 : 3, start, gap);
    case 'hub': {
      const cells = main ? [cell(main, 1, 1)] : [];
      others.forEach((frame, index) => {
        // Past the eight cells around the hub, extra frames wrap in rows below.
        const [col, row] = HUB_CELLS[index] ?? [(index - HUB_CELLS.length) % 3, 3 + Math.floor((index - HUB_CELLS.length) / 3)];
        cells.push(cell(frame, col, row));
      });
      return placeCells(cells, start, gap, 'center');
    }
    case 'spotlight': {
      // More than three side frames split into two side columns.
      const perColumn = Math.max(1, Math.ceil(others.length / Math.ceil(others.length / 3)));
      const rows = Math.max(1, Math.min(others.length, perColumn));
      const cells = main ? [cell(main, 0, 0, { rowSpan: rows })] : [];
      others.forEach((frame, index) => cells.push(cell(frame, 1 + Math.floor(index / perColumn), index % perColumn)));
      return placeCells(cells, start, gap, 'top');
    }
    case 'board':
    default: {
      const sources = frames.find((frame) => roles[frame.id] === 'sources');
      const details = frames.filter((frame) => roles[frame.id] === 'detail');
      const detailRow = main ? 1 : 0;
      const cells = details.map((frame, index) => cell(frame, index, detailRow));
      if (main) cells.push(cell(main, 0, 0, { colSpan: Math.max(1, details.length) }));
      if (sources) cells.push(cell(sources, Math.max(1, details.length), 0, { rowSpan: detailRow + 1 }));
      return placeCells(cells, start, gap);
    }
  }
}

/**
 * Spread the extra width of a stretched frame over its card columns, so the
 * cards fill the frame instead of leaving an empty strip on the right.
 */
function fillFrameWidth(frame: CanvasNode, children: CanvasNode[], padding: number, gap: number): void {
  const cards = children.filter((child) => child.data?.layoutLocked !== true);
  const content = getBoundingRect(cards.map(rectOf));
  if (!content) return;
  const columnXs = [...new Set(cards.map((card) => card.x))].sort((a, b) => a - b);
  const extra = Math.floor((frame.width - padding * 2 - content.width) / columnXs.length);
  if (extra <= 0) return;

  const columnWidths = columnXs.map((x) => Math.max(...cards.filter((card) => card.x === x).map((card) => card.width)));
  const widths = columnWidths.map((width) => Math.max(width, Math.min(MAX_FILLED_CARD_WIDTH, width + extra)));
  const lefts: number[] = [];
  let cursor = frame.x + padding;
  for (const width of widths) {
    lefts.push(cursor);
    cursor += width + gap;
  }
  for (const card of cards) {
    const column = columnXs.indexOf(card.x);
    card.x = lefts[column];
    card.width = widths[column];
  }
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
