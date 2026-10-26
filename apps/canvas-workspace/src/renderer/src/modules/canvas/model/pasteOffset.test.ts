import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../../types';
import { pasteOffset } from './pasteOffset';

const node = (id: string, type: CanvasNode['type'], x: number, y: number, width = 100, height = 100): CanvasNode => ({
  id, type, title: id, x, y, width, height, data: {} as CanvasNode['data'],
});

describe('pasteOffset', () => {
  it('cascades plain nodes so a copy stays in its frame', () => {
    const note = node('note', 'file', 0, 0);
    expect(pasteOffset([note], [note])).toEqual({ x: 24, y: 24 });
  });

  it('moves a copied frame into clear space beside its source', () => {
    const frame = node('frame', 'frame', 0, 0, 400, 300);
    const child = node('child', 'iframe', 20, 20);
    const offset = pasteOffset([frame, child], [frame, child]);
    expect(offset).toEqual({ x: 440, y: 0 });
  });

  it('skips past nodes that already sit to the right', () => {
    const frame = node('frame', 'frame', 0, 0, 400, 300);
    const neighbour = node('n', 'file', 450, 0);
    expect(pasteOffset([frame], [frame, neighbour])).toEqual({ x: 880, y: 0 });
  });
});
