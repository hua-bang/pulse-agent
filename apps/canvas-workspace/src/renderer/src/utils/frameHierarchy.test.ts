import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../types';
import {
  collectCollapsedFrameDescendantIds,
  collectNestedFrameDepths,
  collectNestedFrameIds,
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

describe('nested frame boundaries', () => {
  it('identifies nested frames at every depth while leaving root siblings unmarked', () => {
    const outer = frameNode('outer', 0, 0, 600, 600);
    const inner = frameNode('inner', 50, 50, 350, 350);
    const deepest = frameNode('deepest', 100, 100, 100, 100);
    const sibling = frameNode('sibling', 800, 0, 300, 300);
    expect([...collectNestedFrameIds([outer, inner, deepest, sibling, textNode('note', 120, 120)])].sort())
      .toEqual(['deepest', 'inner']);
  });

  it('updates when the outer frame moves even though the child object is unchanged', () => {
    const outer = frameNode('outer', 0, 0, 500, 500);
    const inner = frameNode('inner', 50, 50, 150, 150);
    expect(collectNestedFrameIds([outer, inner]).has(inner.id)).toBe(true);
    expect(collectNestedFrameIds([{ ...outer, x: 800 }, inner]).has(inner.id)).toBe(false);
  });

  it('reports frame nesting depth, skipping groups, so surfaces can alternate', () => {
    const outer = frameNode('outer', 0, 0, 800, 800);
    const inner = frameNode('inner', 40, 40, 600, 600);
    const group = makeNode('group', 'group', 80, 80, 500, 500, { childIds: ['deeper'] });
    const deeper = frameNode('deeper', 120, 120, 300, 300);
    const deepest = frameNode('deepest', 160, 160, 100, 100);
    const depths = collectNestedFrameDepths([outer, inner, group, deeper, deepest]);
    expect(depths.has('outer')).toBe(false);
    expect(depths.get('inner')).toBe(1);
    expect(depths.get('deeper')).toBe(2);
    expect(depths.get('deepest')).toBe(3);
  });

  it('looks through groups but does not treat a root group as a white frame', () => {
    const outer = frameNode('outer', 0, 0, 600, 600);
    const group = makeNode('group', 'group', 40, 40, 400, 400, { childIds: ['inner'] });
    const inner = frameNode('inner', 80, 80, 160, 160);
    expect([...collectNestedFrameIds([group, inner])]).toEqual([]);
    expect([...collectNestedFrameIds([outer, group, inner])]).toEqual(['inner']);
  });
});
