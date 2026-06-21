import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../types';
import { rectOf, rectsOverlap } from './layout';
import { resolvePlacement } from './placement';

function node(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  type = 'file',
): CanvasNode {
  return {
    id,
    type,
    title: id,
    x,
    y,
    width,
    height,
    data: {},
  };
}

describe('agent placement helpers', () => {
  it('honors explicit coordinates before semantic placement', () => {
    const nodes = [node('anchor', 0, 0, 100, 100)];

    const pos = resolvePlacement(
      nodes,
      { width: 100, height: 80 },
      { x: 123, y: 456 },
      { mode: 'near_node', anchorNodeId: 'anchor' },
    );

    expect(pos).toEqual({ x: 123, y: 456 });
  });

  it('places near an anchor while avoiding existing obstacles', () => {
    const nodes = [
      node('anchor', 0, 0, 100, 100),
      node('obstacle', 148, 0, 100, 100),
    ];

    const pos = resolvePlacement(
      nodes,
      { width: 100, height: 100 },
      {},
      { mode: 'near_node', anchorNodeId: 'anchor', direction: 'right', gap: 48 },
    );

    const placed = { ...pos, width: 100, height: 100 };
    expect(rectsOverlap(placed, rectOf(nodes[1]), 48)).toBe(false);
  });

  it('places inside a frame without colliding with existing frame children', () => {
    const nodes = [
      node('frame', 0, 0, 320, 240, 'frame'),
      node('child', 32, 32, 100, 80),
    ];

    const pos = resolvePlacement(
      nodes,
      { width: 100, height: 80 },
      {},
      { mode: 'inside_frame', frameId: 'frame', padding: 32, gap: 20 },
    );

    const placed = { ...pos, width: 100, height: 80 };
    expect(pos.x).toBeGreaterThanOrEqual(32);
    expect(pos.y).toBeGreaterThanOrEqual(32);
    expect(pos.x + placed.width).toBeLessThanOrEqual(288);
    expect(pos.y + placed.height).toBeLessThanOrEqual(208);
    expect(rectsOverlap(placed, rectOf(nodes[1]), 20)).toBe(false);
  });
});
