import type { CanvasNode } from '../../types';
import { clampSize, DEFAULT_LAYOUT_GAP, getBoundingRect, type Rect } from './geometry';
import type { LayoutMutation } from './layout';

/**
 * Column-aligned grid. Each column is as wide as its widest node and each
 * row as tall as its tallest node, so mixed card sizes (a wide thesis card
 * next to narrower evidence cards) still line up in clean columns instead of
 * the ragged rows a plain left-to-right flow produces. Nodes keep the given
 * order, row by row.
 */
export function layoutGrid(
  nodes: CanvasNode[],
  start: { x: number; y: number },
  options: { columns?: number; gap?: number },
): { mutations: LayoutMutation[]; bounds: Rect | null } {
  const gap = options.gap ?? DEFAULT_LAYOUT_GAP;
  const columns = Math.max(
    1,
    Math.min(options.columns ?? Math.ceil(Math.sqrt(Math.max(1, nodes.length))), Math.max(1, nodes.length)),
  );
  const columnWidths: number[] = [];
  const rowHeights: number[] = [];
  nodes.forEach((node, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    columnWidths[col] = Math.max(columnWidths[col] ?? 0, clampSize(node.width));
    rowHeights[row] = Math.max(rowHeights[row] ?? 0, clampSize(node.height));
  });

  const columnX = offsets(start.x, columnWidths, gap);
  const rowY = offsets(start.y, rowHeights, gap);
  const mutations: LayoutMutation[] = [];
  const rects: Rect[] = [];
  nodes.forEach((node, index) => {
    const rect = {
      x: columnX[index % columns],
      y: rowY[Math.floor(index / columns)],
      width: clampSize(node.width),
      height: clampSize(node.height),
    };
    mutations.push({ nodeId: node.id, x: rect.x, y: rect.y });
    rects.push(rect);
  });

  return { mutations, bounds: getBoundingRect(rects) };
}

export function offsets(start: number, sizes: number[], gap: number): number[] {
  const result: number[] = [];
  let cursor = start;
  for (const size of sizes) {
    result.push(cursor);
    cursor += size + gap;
  }
  return result;
}

/** Default columns for cards inside one frame: one row up to three cards,
 * then a near-square grid capped at three columns so frames stay readable. */
export function defaultFrameColumns(count: number): number {
  if (count <= 3) return Math.max(1, count);
  return Math.min(3, Math.ceil(Math.sqrt(count)));
}
