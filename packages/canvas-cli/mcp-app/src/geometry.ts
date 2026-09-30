/**
 * Pure viewport and edge geometry for the canvas view. World coordinates are
 * the store's node coordinates; screen = world * scale + offset.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Transform {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 3;
export const MIN_NODE_WIDTH = 80;
export const MIN_NODE_HEIGHT = 60;

export const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));

export function screenToWorld(transform: Transform, point: Point): Point {
  return {
    x: (point.x - transform.x) / transform.scale,
    y: (point.y - transform.y) / transform.scale,
  };
}

/** Zoom by `factor` keeping the world point under `anchor` (screen) fixed. */
export function zoomAt(transform: Transform, factor: number, anchor: Point): Transform {
  const scale = clampScale(transform.scale * factor);
  const world = screenToWorld(transform, anchor);
  return { scale, x: anchor.x - world.x * scale, y: anchor.y - world.y * scale };
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.width);
    maxY = Math.max(maxY, rect.y + rect.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Transform that fits every rect in the viewport; never zooms in past 1. */
export function fitTransform(rects: Rect[], viewport: { width: number; height: number }, padding = 48): Transform {
  const bounds = boundsOf(rects);
  if (!bounds || viewport.width <= 0 || viewport.height <= 0) return { x: padding, y: padding, scale: 1 };
  const scale = clampScale(Math.min(
    1,
    (viewport.width - padding * 2) / Math.max(bounds.width, 1),
    (viewport.height - padding * 2) / Math.max(bounds.height, 1),
  ));
  return {
    scale,
    x: (viewport.width - bounds.width * scale) / 2 - bounds.x * scale,
    y: (viewport.height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

export const rectCenter = (rect: Rect): Point => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

export function containsPoint(rect: Rect, point: Point): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

/** Point where the ray from the rect's center toward `toward` leaves the rect. */
export function borderPoint(rect: Rect, toward: Point): Point {
  const center = rectCenter(rect);
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const scaleX = dx === 0 ? Infinity : (rect.width / 2) / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : (rect.height / 2) / Math.abs(dy);
  const t = Math.min(scaleX, scaleY);
  return { x: center.x + dx * t, y: center.y + dy * t };
}

export type EdgeEnd = Rect | Point;

const isRect = (end: EdgeEnd): end is Rect => 'width' in end;

export interface EdgeGeometry {
  from: Point;
  to: Point;
  mid: Point;
}

export function edgeGeometry(source: EdgeEnd, target: EdgeEnd): EdgeGeometry {
  const sourceCenter = isRect(source) ? rectCenter(source) : source;
  const targetCenter = isRect(target) ? rectCenter(target) : target;
  const from = isRect(source) ? borderPoint(source, targetCenter) : source;
  const to = isRect(target) ? borderPoint(target, sourceCenter) : target;
  return { from, to, mid: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } };
}

/** Triangle arrowhead at `tip`, pointing away from `from`, as an SVG points list. */
export function arrowPoints(from: Point, tip: Point, size: number): string {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const spread = Math.PI / 7;
  const left = { x: tip.x - size * Math.cos(angle - spread), y: tip.y - size * Math.sin(angle - spread) };
  const right = { x: tip.x - size * Math.cos(angle + spread), y: tip.y - size * Math.sin(angle + spread) };
  const fmt = (point: Point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
  return `${fmt(tip)} ${fmt(left)} ${fmt(right)}`;
}

export interface IdRect extends Rect {
  id: string;
}

/**
 * Nodes a frame carries when dragged: every other node whose center lies
 * inside it (same geometric containment rule as `pulse-canvas layout`).
 */
export function containedIds(frame: IdRect, nodes: IdRect[]): string[] {
  return nodes
    .filter(node => node.id !== frame.id && containsPoint(frame, rectCenter(node)))
    .map(node => node.id);
}

export function resizedRect(rect: Rect, dx: number, dy: number): Rect {
  return {
    ...rect,
    width: Math.max(MIN_NODE_WIDTH, Math.round(rect.width + dx)),
    height: Math.max(MIN_NODE_HEIGHT, Math.round(rect.height + dy)),
  };
}
