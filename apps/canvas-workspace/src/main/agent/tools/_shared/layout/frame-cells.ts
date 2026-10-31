import type { Rect } from './geometry';
import { offsets } from './grid';

/**
 * Track-based placement for whole frames. Each frame takes a cell in a grid
 * of columns and rows. A column is as wide as its widest frame and a row as
 * tall as its tallest frame, and every frame is stretched to fill its cell,
 * so frames that share a row end on one line and frames that share a column
 * have one width. A cell can span several columns or rows.
 */
export interface FrameCell {
  id: string;
  width: number;
  height: number;
  col: number;
  row: number;
  colSpan?: number;
  rowSpan?: number;
}

export type FrameBox = Rect & { id: string };

/**
 * `stretch` (default) grows each frame to fill its cell. `top` grows only the
 * width, so a column keeps one width while bottoms stay ragged instead of
 * opening empty space in a short frame. `center` keeps each frame's size and
 * centers it in its cell, for designs that radiate from a middle frame.
 */
export function placeCells(
  cells: FrameCell[],
  start: { x: number; y: number },
  gap: number,
  align: 'stretch' | 'top' | 'center' = 'stretch',
): FrameBox[] {
  if (cells.length === 0) return [];
  // Drop empty tracks so a sparse grid (a hub with two spokes) stays compact.
  const colIndex = compactTracks(cells.flatMap((cell) => spanned(cell.col, cell.colSpan)));
  const rowIndex = compactTracks(cells.flatMap((cell) => spanned(cell.row, cell.rowSpan)));
  const placed = cells.map((cell) => {
    const col = colIndex.get(cell.col) as number;
    const row = rowIndex.get(cell.row) as number;
    const colEnd = colIndex.get(cell.col + (cell.colSpan ?? 1) - 1) as number;
    const rowEnd = rowIndex.get(cell.row + (cell.rowSpan ?? 1) - 1) as number;
    return { ...cell, col, row, colSpan: colEnd - col + 1, rowSpan: rowEnd - row + 1 };
  });

  const widths = trackSizes(placed, colIndex.size, gap, 'col');
  const heights = trackSizes(placed, rowIndex.size, gap, 'row');
  const xs = offsets(start.x, widths, gap);
  const ys = offsets(start.y, heights, gap);

  return placed.map((cell) => {
    const width = spanSize(widths, cell.col, cell.colSpan, gap);
    const height = spanSize(heights, cell.row, cell.rowSpan, gap);
    if (align === 'stretch') return { id: cell.id, x: xs[cell.col], y: ys[cell.row], width, height };
    if (align === 'top') return { id: cell.id, x: xs[cell.col], y: ys[cell.row], width, height: cell.height };
    return {
      id: cell.id,
      x: xs[cell.col] + Math.round((width - cell.width) / 2),
      y: ys[cell.row] + Math.round((height - cell.height) / 2),
      width: cell.width,
      height: cell.height,
    };
  });
}

/**
 * Masonry columns: each frame goes to the shortest column, in order, and
 * takes that column's width. Column bottoms stay ragged; stretching a frame
 * to even them out would only add empty space.
 */
export function placeMasonry(
  frames: Array<{ id: string; width: number; height: number }>,
  columns: number,
  start: { x: number; y: number },
  gap: number,
): FrameBox[] {
  const stacks: Array<typeof frames> = Array.from({ length: Math.max(1, Math.min(columns, frames.length)) }, () => []);
  const stackHeight = (stack: typeof frames) => stack.reduce((sum, frame) => sum + frame.height + gap, 0);
  for (const frame of frames) {
    const shortest = stacks.reduce((best, stack) => (stackHeight(stack) < stackHeight(best) ? stack : best));
    shortest.push(frame);
  }

  const boxes = new Map<string, FrameBox>();
  let x = start.x;
  for (const stack of stacks) {
    const width = Math.max(...stack.map((frame) => frame.width));
    let y = start.y;
    for (const frame of stack) {
      boxes.set(frame.id, { id: frame.id, x, y, width, height: frame.height });
      y += frame.height + gap;
    }
    x += width + gap;
  }
  return frames.map((frame) => boxes.get(frame.id) as FrameBox);
}

function spanned(first: number, span = 1): number[] {
  return Array.from({ length: Math.max(1, span) }, (_, index) => first + index);
}

function compactTracks(used: number[]): Map<number, number> {
  return new Map([...new Set(used)].sort((a, b) => a - b).map((track, index) => [track, index]));
}

function trackSizes(cells: Array<Required<FrameCell>>, count: number, gap: number, axis: 'col' | 'row'): number[] {
  const sizes = Array.from({ length: count }, () => 0);
  const start = (cell: Required<FrameCell>) => (axis === 'col' ? cell.col : cell.row);
  const span = (cell: Required<FrameCell>) => (axis === 'col' ? cell.colSpan : cell.rowSpan);
  const size = (cell: Required<FrameCell>) => (axis === 'col' ? cell.width : cell.height);

  for (const cell of cells) {
    if (span(cell) === 1) sizes[start(cell)] = Math.max(sizes[start(cell)], size(cell));
  }
  // A spanning cell that does not fit widens its columns evenly, or makes
  // its last row taller, so the extra space lands below the content.
  for (const cell of cells) {
    if (span(cell) === 1) continue;
    const missing = size(cell) - spanSize(sizes, start(cell), span(cell), gap);
    if (missing <= 0) continue;
    if (axis === 'row') {
      sizes[start(cell) + span(cell) - 1] += missing;
      continue;
    }
    for (let index = 0; index < span(cell); index += 1) sizes[start(cell) + index] += missing / span(cell);
  }
  return sizes.map(Math.round);
}

function spanSize(sizes: number[], first: number, span: number, gap: number): number {
  let total = 0;
  for (let index = first; index < first + span; index += 1) total += sizes[index];
  return total + gap * (span - 1);
}
