import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../types';
import {
  applyLayoutMutations,
  buildLayoutSnapshot,
  planCanvasGrid,
  planFrameGrid,
  planPlaceNear,
  rectOf,
  rectsOverlap,
} from './layout';

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

describe('canvas layout helpers', () => {
  it('places nodes near an anchor without colliding with existing nodes', () => {
    const nodes = [
      node('anchor', 0, 0, 100, 100),
      node('obstacle', 148, 0, 100, 100),
      node('target', -400, -400, 100, 100),
    ];

    const plan = planPlaceNear(nodes, ['target'], {
      anchorNodeId: 'anchor',
      direction: 'right',
      gap: 48,
    });
    applyLayoutMutations(nodes, plan.mutations);

    const target = nodes.find((n) => n.id === 'target');
    const obstacle = nodes.find((n) => n.id === 'obstacle');
    if (!target || !obstacle) throw new Error('missing test nodes');
    expect(rectsOverlap(rectOf(target), rectOf(obstacle), 48)).toBe(false);
  });

  it('lays children inside a frame and resizes the frame to fit them', () => {
    const nodes = [
      node('frame', 0, 0, 200, 100, 'frame'),
      node('a', 500, 0, 100, 80),
      node('b', 500, 100, 100, 80),
      node('c', 500, 200, 100, 80),
    ];

    const plan = planFrameGrid(nodes, 'frame', {
      nodeIds: ['a', 'b', 'c'],
      columns: 2,
      gap: 10,
      padding: 20,
    });
    applyLayoutMutations(nodes, plan.mutations);

    expect(nodes.find((n) => n.id === 'a')).toMatchObject({ x: 20, y: 20 });
    expect(nodes.find((n) => n.id === 'b')).toMatchObject({ x: 130, y: 20 });
    expect(nodes.find((n) => n.id === 'c')).toMatchObject({ x: 20, y: 110 });
    expect(nodes.find((n) => n.id === 'frame')).toMatchObject({ width: 250, height: 210 });
  });

  it('moves spatial children when a frame is arranged on the canvas grid', () => {
    const nodes = [
      node('frame', 0, 0, 240, 180, 'frame'),
      node('child', 24, 24, 100, 80),
      node('loose', 400, 0, 120, 80),
    ];

    const frameBefore = { ...nodes[0] };
    const childBefore = { ...nodes[1] };
    const plan = planCanvasGrid(nodes, {
      nodeIds: ['frame', 'loose'],
      columns: 1,
      startX: 500,
      startY: 500,
      gap: 48,
    });
    applyLayoutMutations(nodes, plan.mutations);

    const frame = nodes.find((n) => n.id === 'frame');
    const child = nodes.find((n) => n.id === 'child');
    if (!frame || !child) throw new Error('missing test nodes');
    const dx = frame.x - frameBefore.x;
    const dy = frame.y - frameBefore.y;

    expect(child.x).toBe(childBefore.x + dx);
    expect(child.y).toBe(childBefore.y + dy);
  });

  it('reports non-container overlaps while treating frame containment as normal', () => {
    const nodes = [
      node('frame', 0, 0, 240, 180, 'frame'),
      node('child', 24, 24, 100, 80),
      node('overlap-a', 400, 0, 100, 100),
      node('overlap-b', 450, 20, 100, 100),
    ];

    const snapshot = buildLayoutSnapshot(nodes);

    expect(snapshot.frames[0].childIds).toEqual(['child']);
    expect(snapshot.overlaps).toEqual([
      { a: 'overlap-a', b: 'overlap-b', area: 4000 },
    ]);
  });
});
