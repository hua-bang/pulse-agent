import { describe, expect, it } from 'vitest';
import type { CanvasEdge, CanvasNode } from '../types';
import { createDefaultEdge, edgePathGeometry } from './edgeFactory';

describe('createDefaultEdge', () => {
  it('stores the canonical high-contrast edge stroke', () => {
    const edge = createDefaultEdge(
      { kind: 'point', x: 0, y: 0 },
      { kind: 'point', x: 100, y: 0 },
    );

    expect(edge.stroke).toEqual({
      color: '#2e2e2e',
      width: 4,
      style: 'solid',
    });
  });

  it('adds a manual bend continuously on top of automatic node routing', () => {
    const nodes: CanvasNode[] = [
      { id: 'a', x: 0, y: 0, width: 100, height: 60 } as CanvasNode,
      { id: 'b', x: 146, y: 102, width: 100, height: 60 } as CanvasNode,
    ];
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const edge: CanvasEdge = {
      id: 'curved',
      source: { kind: 'node', nodeId: 'a', anchor: 'right' },
      target: { kind: 'node', nodeId: 'b', anchor: 'top' },
      bend: 0,
    };
    const sourcePoint = { x: 100, y: 30 };
    const targetPoint = { x: 196, y: 102 };
    const automatic = edgePathGeometry(edge, sourcePoint, targetPoint, nodesById);
    const moved = edgePathGeometry({ ...edge, bend: 1 }, sourcePoint, targetPoint, nodesById);

    expect(moved.d).toContain(' C ');
    expect(Math.hypot(
      moved.midpoint.x - automatic.midpoint.x,
      moved.midpoint.y - automatic.midpoint.y,
    )).toBeCloseTo(1);
  });
});
