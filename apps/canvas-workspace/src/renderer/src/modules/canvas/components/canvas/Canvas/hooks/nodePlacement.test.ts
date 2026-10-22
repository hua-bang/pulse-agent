import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../../../../../types';
import { computeParentContainerMap } from '../../../../../../utils/frameHierarchy';
import { findFreeSlot, resolveNonStackingSlot } from './nodePlacement';

const node = (id: string, x: number, y: number, width: number, height: number, type = 'file') =>
  ({ id, type, x, y, width, height, title: id, data: {} }) as unknown as CanvasNode;

const overlaps = (a: { x: number; y: number }, w: number, h: number, b: CanvasNode) =>
  a.x < b.x + b.width && a.x + w > b.x && a.y < b.y + b.height && a.y + h > b.y;

describe('findFreeSlot', () => {
  it('keeps the desired position when it is clear', () => {
    expect(findFreeSlot([node('a', 1000, 1000, 100, 100)], 0, 0, 200, 100)).toEqual({ x: 0, y: 0 });
  });

  it('moves a new node off the nodes under the viewport centre', () => {
    const existing = [node('a', 0, 0, 400, 300), node('b', 420, 0, 400, 300)];
    const slot = findFreeSlot(existing, 200, 100, 300, 200);
    for (const n of existing) expect(overlaps(slot, 300, 200, n)).toBe(false);
  });

  it('does not let a new frame adopt existing nodes or a new node join a frame', () => {
    const frame = node('frame', 0, 0, 600, 400, 'frame');
    const child = node('child', 100, 100, 200, 150);
    const existing = [frame, child];

    const frameSlot = findFreeSlot(existing, 50, 50, 500, 350);
    const newFrame = node('new-frame', frameSlot.x, frameSlot.y, 500, 350, 'frame');
    const parents = computeParentContainerMap([...existing, newFrame]);
    expect(parents.get('child')).toBe('frame');
    expect(parents.get('frame')).toBeNull();

    const textSlot = findFreeSlot(existing, 250, 180, 120, 40);
    const text = node('text', textSlot.x, textSlot.y, 120, 40, 'text');
    expect(computeParentContainerMap([...existing, text]).get('text')).toBeNull();
  });
});

describe('resolveNonStackingSlot', () => {
  it('cascades only when the top-left would stack on another node', () => {
    expect(resolveNonStackingSlot([node('a', 0, 0, 100, 100)], 5, 5)).toEqual({ x: 29, y: 29 });
    expect(resolveNonStackingSlot([node('a', 0, 0, 100, 100)], 50, 50)).toEqual({ x: 50, y: 50 });
  });
});
