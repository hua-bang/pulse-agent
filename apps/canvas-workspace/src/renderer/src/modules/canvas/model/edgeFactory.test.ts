import { describe, expect, it } from 'vitest';
import type { CanvasEdge, CanvasNode } from '../../../types';
import {
  createDefaultEdge,
  edgePathGeometry,
  resolveEdgePathGeometry,
  resolveEndpointToward,
} from './edgeFactory';

describe('createDefaultEdge', () => {
  it('stores the canonical soft gray edge stroke', () => {
    const edge = createDefaultEdge(
      { kind: 'point', x: 0, y: 0 },
      { kind: 'point', x: 100, y: 0 },
    );

    expect(edge.stroke).toEqual({
      color: '#6b6b67',
      width: 2.4,
      style: 'solid',
    });
  });

  it('preserves the quadratic geometry of existing manual node bends', () => {
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
    const moved = edgePathGeometry({ ...edge, bend: 1 }, sourcePoint, targetPoint, nodesById);

    expect(moved.d).toContain(' Q ');
    expect(moved.midpoint.x).toBeCloseTo(148.6);
    expect(moved.midpoint.y).toBeCloseTo(65.2);
  });

  it('moves a new smooth bend continuously from the automatic cubic', () => {
    const nodes: CanvasNode[] = [
      { id: 'a', x: 0, y: 0, width: 100, height: 60 } as CanvasNode,
      { id: 'b', x: 146, y: 102, width: 100, height: 60 } as CanvasNode,
    ];
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const edge: CanvasEdge = {
      id: 'smooth',
      source: { kind: 'node', nodeId: 'a', anchor: 'right' },
      target: { kind: 'node', nodeId: 'b', anchor: 'top' },
      bend: 0,
    };
    const sourcePoint = { x: 100, y: 30 };
    const targetPoint = { x: 196, y: 102 };
    const automatic = edgePathGeometry(edge, sourcePoint, targetPoint, nodesById);
    const moved = edgePathGeometry(
      { ...edge, bend: 1, curveMode: 'smooth' },
      sourcePoint,
      targetPoint,
      nodesById,
    );

    expect(moved.d).toContain(' C ');
    expect(Math.hypot(
      moved.midpoint.x - automatic.midpoint.x,
      moved.midpoint.y - automatic.midpoint.y,
    )).toBeCloseTo(1);
  });
});

describe('automatic edge geometry', () => {
  const nodes: CanvasNode[] = [
    { id: 'a', x: 0, y: 0, width: 100, height: 60 } as CanvasNode,
    { id: 'b', x: 400, y: 200, width: 100, height: 60 } as CanvasNode,
  ];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  it('attaches auto anchors to the midpoint of the facing side', () => {
    const auto = { kind: 'node' as const, nodeId: 'a', anchor: 'auto' as const };

    expect(resolveEndpointToward(auto, nodesById, { x: 450, y: 230 })).toEqual({ x: 100, y: 30 });
    expect(resolveEndpointToward(auto, nodesById, { x: 60, y: 400 })).toEqual({ x: 50, y: 60 });
    expect(resolveEndpointToward(auto, nodesById, { x: -200, y: 40 })).toEqual({ x: 0, y: 30 });
  });

  it('leaves and enters bound nodes along the side normals', () => {
    const edge = createDefaultEdge(
      { kind: 'node', nodeId: 'a', anchor: 'auto' },
      { kind: 'node', nodeId: 'b', anchor: 'auto' },
    );
    const geometry = resolveEdgePathGeometry(edge, nodesById);

    expect(geometry.sourcePoint).toEqual({ x: 100, y: 30 });
    // The arrow gap is reserved along the target's outward normal.
    expect(geometry.targetPoint).toEqual({ x: 396, y: 230 });
    expect(geometry.d.startsWith('M 100 30 C ')).toBe(true);
    const [c1y, , c2y] = geometry.d.split(' C ')[1].split(' ').map(Number).filter((_, i) => i % 2 === 1);
    expect(c1y).toBe(30);
    expect(c2y).toBe(230);
  });

  it('curves out of a bound node toward a free end', () => {
    const edge = createDefaultEdge(
      { kind: 'node', nodeId: 'a', anchor: 'auto' },
      { kind: 'point', x: 300, y: 300 },
    );
    const geometry = resolveEdgePathGeometry(edge, nodesById);

    expect(geometry.d).toContain(' C ');
    expect(geometry.d.endsWith(' 300 300 300 300')).toBe(true);
  });

  it('sizes handles from the travel along each normal', () => {
    const explicit = (anchorA: 'right' | 'left', anchorB: 'left' | 'right'): CanvasEdge => ({
      id: 'e',
      source: { kind: 'node', nodeId: 'a', anchor: anchorA },
      target: { kind: 'node', nodeId: 'b', anchor: anchorB },
    });
    // Target ahead of the source: half of the 300px horizontal travel.
    const ahead = edgePathGeometry(explicit('right', 'left'), { x: 100, y: 30 }, { x: 400, y: 230 }, nodesById);
    expect(ahead.d).toBe('M 100 30 C 250 30 250 230 400 230');

    // Target behind the source normal: a gentle square-root loop.
    const behind = edgePathGeometry(explicit('left', 'right'), { x: 0, y: 30 }, { x: 500, y: 230 }, nodesById);
    const loop = 6.25 * Math.sqrt(500);
    expect(behind.d).toBe(`M 0 30 C ${-loop} 30 ${500 + loop} 230 500 230`);
  });
});
