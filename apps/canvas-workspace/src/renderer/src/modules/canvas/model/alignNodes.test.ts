import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../../types';
import { alignNodeMoves } from './alignNodes';

const node = (id: string, x: number, y: number, width = 100, height = 50, type: CanvasNode['type'] = 'text'): CanvasNode => ({
  id, type, title: id, x, y, width, height, data: {} as CanvasNode['data'],
});

describe('alignNodeMoves', () => {
  const a = node('a', 0, 0);
  const b = node('b', 200, 40, 60, 80);
  const c = node('c', 500, 10, 100, 20);

  it('aligns left and right edges to the shared bounds', () => {
    expect(alignNodeMoves([a, b], ['a', 'b'], 'left')).toEqual([{ id: 'b', x: 0, y: 40 }]);
    expect(alignNodeMoves([a, b], ['a', 'b'], 'right')).toEqual([{ id: 'a', x: 160, y: 0 }]);
  });

  it('centers vertically on the shared middle', () => {
    // Bounds 0..120, so the middle is 60.
    expect(alignNodeMoves([a, b], ['a', 'b'], 'middle')).toEqual([
      { id: 'a', x: 0, y: 35 },
      { id: 'b', x: 200, y: 20 },
    ]);
  });

  it('distributes with equal gaps and keeps the outer nodes', () => {
    // Span 0..600, widths 260, so each of the two gaps is 170.
    expect(alignNodeMoves([c, a, b], ['a', 'b', 'c'], 'distributeX')).toEqual([
      { id: 'b', x: 270, y: 40 },
    ]);
  });

  it('needs two nodes to align and three to distribute', () => {
    expect(alignNodeMoves([a], ['a'], 'left')).toEqual([]);
    expect(alignNodeMoves([a, b], ['a', 'b'], 'distributeY')).toEqual([]);
  });

  it('moves a selected frame with its contents', () => {
    const frame = node('f', 300, 300, 200, 200, 'frame');
    const inside = node('in', 320, 320, 50, 50);
    expect(alignNodeMoves([a, frame, inside], ['a', 'f'], 'top')).toEqual([
      { id: 'f', x: 300, y: 0 },
      { id: 'in', x: 320, y: 20 },
    ]);
  });
});
