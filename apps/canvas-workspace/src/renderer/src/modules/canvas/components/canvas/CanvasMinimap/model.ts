import type { CanvasTransform } from '../../../../../types';

export interface MinimapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Maps canvas coordinates into the minimap: `map = (canvas - origin) * scale + offset`. */
export interface MinimapLayout {
  originX: number;
  originY: number;
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** The canvas area the view shows, in canvas coordinates. */
export const viewportCanvasRect = (
  transform: CanvasTransform,
  viewport: { width: number; height: number },
): MinimapRect => {
  const scale = Math.max(transform.scale, 0.0001);
  return {
    x: -transform.x / scale,
    y: -transform.y / scale,
    width: viewport.width / scale,
    height: viewport.height / scale,
  };
};

/** Smallest rectangle that holds every box. Empty input gives null. */
export const unionRect = (rects: readonly MinimapRect[]): MinimapRect | null => {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** Fit `world` into a `size` map with `padding` px on each side, centred. */
export const fitMinimap = (
  world: MinimapRect,
  size: { width: number; height: number },
  padding: number,
): MinimapLayout => {
  const innerWidth = Math.max(size.width - padding * 2, 1);
  const innerHeight = Math.max(size.height - padding * 2, 1);
  const scale = Math.min(innerWidth / Math.max(world.width, 1), innerHeight / Math.max(world.height, 1));
  return {
    originX: world.x,
    originY: world.y,
    scale,
    offsetX: (size.width - world.width * scale) / 2,
    offsetY: (size.height - world.height * scale) / 2,
  };
};

export const toMinimapRect = (layout: MinimapLayout, rect: MinimapRect): MinimapRect => ({
  x: (rect.x - layout.originX) * layout.scale + layout.offsetX,
  y: (rect.y - layout.originY) * layout.scale + layout.offsetY,
  width: rect.width * layout.scale,
  height: rect.height * layout.scale,
});

export const toCanvasPoint = (layout: MinimapLayout, x: number, y: number): { x: number; y: number } => ({
  x: (x - layout.offsetX) / layout.scale + layout.originX,
  y: (y - layout.offsetY) / layout.scale + layout.originY,
});
