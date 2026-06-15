import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../types';
import {
  collectCollapsedFrameDescendantIds,
  filterCollapsedFrameDescendants,
} from './frameHierarchy';

const makeNode = (
  id: string,
  type: CanvasNode['type'],
  x: number,
  y: number,
  width: number,
  height: number,
  data: CanvasNode['data'],
): CanvasNode => ({
  id,
  type,
  title: id,
  x,
  y,
  width,
  height,
  data,
});

const textNode = (
  id: string,
  x: number,
  y: number,
): CanvasNode => makeNode(id, 'text', x, y, 40, 40, {
  content: '',
  textColor: '#111111',
  backgroundColor: 'transparent',
});

const frameNode = (
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  childrenCollapsed = false,
): CanvasNode => makeNode(id, 'frame', x, y, width, height, {
  color: '#9575d4',
  ...(childrenCollapsed ? { childrenCollapsed: true } : {}),
});

describe('frameHierarchy collapsed frames', () => {
  it('hides transitive descendants while keeping the collapsed frame visible', () => {
    const outer = frameNode('outer', 0, 0, 300, 300, true);
    const child = textNode('child', 40, 40);
    const nestedFrame = frameNode('nested-frame', 80, 80, 140, 140);
    const nestedChild = textNode('nested-child', 110, 110);
    const outside = textNode('outside', 420, 420);
    const nodes = [outer, child, nestedFrame, nestedChild, outside];

    expect(Array.from(collectCollapsedFrameDescendantIds(nodes)).sort()).toEqual([
      'child',
      'nested-child',
      'nested-frame',
    ]);
    expect(filterCollapsedFrameDescendants(nodes).map((node) => node.id)).toEqual([
      'outer',
      'outside',
    ]);
  });

  it('returns the original node array when no frame is collapsed', () => {
    const nodes = [
      frameNode('frame', 0, 0, 300, 300),
      textNode('child', 40, 40),
    ];

    expect(collectCollapsedFrameDescendantIds(nodes).size).toBe(0);
    expect(filterCollapsedFrameDescendants(nodes)).toBe(nodes);
  });
});
