import type { CanvasNode } from '../types';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_LAYOUT_GAP = 48;
export const DEFAULT_FRAME_PADDING = 32;
export const DEFAULT_GRID = 24;
export const MIN_NODE_SIZE = 40;

export function right(rect: Rect): number {
  return rect.x + rect.width;
}

export function bottom(rect: Rect): number {
  return rect.y + rect.height;
}

export function centerX(rect: Rect): number {
  return rect.x + rect.width / 2;
}

export function centerY(rect: Rect): number {
  return rect.y + rect.height / 2;
}

export function clampSize(n: number): number {
  return Math.max(MIN_NODE_SIZE, n);
}

export function alignToGrid(value: number, grid: number): number {
  if (grid <= 1) return Math.round(value);
  return Math.round(value / grid) * grid;
}

export function rectOf(node: CanvasNode): Rect {
  return {
    x: node.x,
    y: node.y,
    width: clampSize(node.width),
    height: clampSize(node.height),
  };
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return (
    a.x < b.x + b.width + gap &&
    a.x + a.width + gap > b.x &&
    a.y < b.y + b.height + gap &&
    a.y + a.height + gap > b.y
  );
}

export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));
  return w * h;
}

export function rectContainsRect(container: Rect, child: Rect): boolean {
  return (
    child.x >= container.x &&
    child.y >= container.y &&
    right(child) <= right(container) &&
    bottom(child) <= bottom(container)
  );
}

export function rectContainsCenter(container: Rect, child: Rect): boolean {
  const cx = centerX(child);
  const cy = centerY(child);
  return cx >= container.x && cx <= right(container) && cy >= container.y && cy <= bottom(container);
}

export function getBoundingRect(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, right(rect));
    maxY = Math.max(maxY, bottom(rect));
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
