import { describe, expect, it } from 'vitest';
import { fitMinimap, toCanvasPoint, toMinimapRect, unionRect, viewportCanvasRect } from './model';

describe('canvas minimap geometry', () => {
  it('finds the visible canvas area from the transform', () => {
    expect(viewportCanvasRect({ x: -200, y: 100, scale: 2 }, { width: 800, height: 600 }))
      .toEqual({ x: 100, y: -50, width: 400, height: 300 });
  });

  it('bounds every box, and nothing for no boxes', () => {
    expect(unionRect([])).toBeNull();
    expect(unionRect([
      { x: 0, y: 0, width: 100, height: 50 },
      { x: -40, y: 80, width: 20, height: 20 },
    ])).toEqual({ x: -40, y: 0, width: 140, height: 100 });
  });

  it('fits the world inside the padding, centred, and maps points both ways', () => {
    const layout = fitMinimap({ x: 100, y: 0, width: 400, height: 100 }, { width: 200, height: 120 }, 10);
    expect(layout.scale).toBe(0.45);
    expect(toMinimapRect(layout, { x: 100, y: 0, width: 400, height: 100 }))
      .toEqual({ x: 10, y: 37.5, width: 180, height: 45 });
    const mapped = toMinimapRect(layout, { x: 300, y: 50, width: 0, height: 0 });
    expect(toCanvasPoint(layout, mapped.x, mapped.y)).toEqual({ x: 300, y: 50 });
  });
});
