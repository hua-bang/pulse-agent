import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../types';
import { layoutGrid } from './grid';
import { applyLayoutMutations, buildLayoutSnapshot, getFrameChildren } from './layout';
import { planLayoutPreset } from './layout-presets';

function node(id: string, x: number, y: number, width: number, height: number, type = 'file'): CanvasNode {
  return { id, type, title: id, x, y, width, height, data: {} };
}

/** A frame with `count` cards inside it, laid out loosely. */
function frameWithCards(id: string, x: number, y: number, count: number, cardWidth = 300): CanvasNode[] {
  const frame = node(id, x, y, 1400, 1200, 'frame');
  const cards = Array.from({ length: count }, (_, index) =>
    node(`${id}-card-${index}`, x + 40 + index * 30, y + 40 + index * 30, cardWidth, 200));
  return [frame, ...cards];
}

function apply(nodes: CanvasNode[], options: Parameters<typeof planLayoutPreset>[1]) {
  const plan = planLayoutPreset(nodes, options);
  applyLayoutMutations(nodes, plan.mutations, 0);
  return { plan, byId: new Map(nodes.map((item) => [item.id, item])) };
}

describe('layoutGrid', () => {
  it('aligns columns to the widest node in each column', () => {
    const nodes = [node('a', 0, 0, 500, 100), node('b', 0, 0, 300, 100), node('c', 0, 0, 300, 100), node('d', 0, 0, 300, 100)];
    const { mutations } = layoutGrid(nodes, { x: 0, y: 0 }, { columns: 2, gap: 10 });

    expect(mutations.map((m) => [m.nodeId, m.x, m.y])).toEqual([
      ['a', 0, 0],
      ['b', 510, 0],
      ['c', 0, 110],
      ['d', 510, 110],
    ]);
  });
});

describe('planLayoutPreset', () => {
  it('board: overview spans the top, details sit in a row, sources run down the right edge', () => {
    const nodes = [
      ...frameWithCards('overview', 0, 0, 3),
      ...frameWithCards('detail-a', 2000, 0, 2),
      ...frameWithCards('detail-b', 4000, 0, 2),
      ...frameWithCards('sources', 6000, 0, 3),
    ];
    const { plan, byId } = apply(nodes, {
      preset: 'board',
      frameIds: ['overview', 'detail-a', 'detail-b', 'sources'],
      sourcesFrameId: 'sources',
      startX: 0,
      startY: 0,
    });
    const overview = byId.get('overview')!;
    const detailA = byId.get('detail-a')!;
    const detailB = byId.get('detail-b')!;
    const sources = byId.get('sources')!;

    expect(plan.roles).toEqual({ overview: 'overview', 'detail-a': 'detail', 'detail-b': 'detail', sources: 'sources' });
    expect(detailA.y).toBeGreaterThan(overview.y + overview.height);
    expect(detailB.y).toBe(detailA.y);
    expect(detailB.x).toBeGreaterThan(detailA.x + detailA.width);
    expect(overview.width).toBeGreaterThanOrEqual(detailB.x + detailB.width - detailA.x);
    expect(sources.x).toBeGreaterThan(overview.x + overview.width);
    expect(sources.y).toBe(overview.y);
    // Every card stays inside its frame and nothing overlaps.
    for (const frameId of plan.frameIds) {
      expect(getFrameChildren(nodes, frameId)).toHaveLength(frameId.startsWith('detail') ? 2 : 3);
    }
    expect(buildLayoutSnapshot(nodes).overlaps).toEqual([]);
  });

  it('flow: frames left to right with cards stacked in one column', () => {
    const nodes = [...frameWithCards('step-1', 0, 0, 3), ...frameWithCards('step-2', 0, 3000, 2)];
    const { byId } = apply(nodes, { preset: 'flow', startX: 0, startY: 0 });

    expect(byId.get('step-2')!.y).toBe(byId.get('step-1')!.y);
    expect(byId.get('step-2')!.x).toBeGreaterThan(byId.get('step-1')!.x + byId.get('step-1')!.width);
    const cards = ['step-1-card-0', 'step-1-card-1', 'step-1-card-2'].map((id) => byId.get(id)!);
    expect(new Set(cards.map((card) => card.x)).size).toBe(1);
    expect(buildLayoutSnapshot(nodes).overlaps).toEqual([]);
  });

  it('matrix and stack place frames in two columns or one aligned column', () => {
    const matrixNodes = ['q1', 'q2', 'q3', 'q4'].flatMap((id, index) => frameWithCards(id, index * 2000, 0, 2));
    const matrix = apply(matrixNodes, { preset: 'matrix', startX: 0, startY: 0 }).byId;
    expect(matrix.get('q3')!.x).toBe(matrix.get('q1')!.x);
    expect(matrix.get('q2')!.y).toBe(matrix.get('q1')!.y);
    expect(buildLayoutSnapshot(matrixNodes).overlaps).toEqual([]);

    const stackNodes = [...frameWithCards('intro', 0, 0, 1, 300), ...frameWithCards('body', 2000, 0, 4, 300)];
    const stack = apply(stackNodes, { preset: 'stack', startX: 0, startY: 0 }).byId;
    expect(stack.get('body')!.x).toBe(stack.get('intro')!.x);
    expect(stack.get('body')!.width).toBe(stack.get('intro')!.width);
    expect(stack.get('body')!.y).toBeGreaterThan(stack.get('intro')!.y + stack.get('intro')!.height);
  });

  it('rejects ids that are not frames', () => {
    const nodes = [node('card', 0, 0, 100, 100)];
    expect(() => planLayoutPreset(nodes, { preset: 'flow', frameIds: ['card'] })).toThrow('Frame not found: card');
  });
});
