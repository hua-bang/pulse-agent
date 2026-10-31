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

  it('gives frames in one row one height and widens cards to fill a stretched frame', () => {
    const nodes = [...frameWithCards('short', 0, 0, 1), ...frameWithCards('tall', 2000, 0, 3)];
    const { byId } = apply(nodes, { preset: 'flow', startX: 0, startY: 0 });
    expect(byId.get('short')!.height).toBe(byId.get('tall')!.height);

    const stackNodes = [...frameWithCards('intro', 0, 0, 1, 300), ...frameWithCards('body', 2000, 0, 2, 300)];
    const stack = apply(stackNodes, { preset: 'stack', startX: 0, startY: 0 }).byId;
    const intro = stack.get('intro')!;
    const card = stack.get('intro-card-0')!;
    // The single intro card now spans the frame that stretched to the body width.
    expect(card.x).toBe(intro.x + 32);
    expect(card.width).toBe(intro.width - 64);
  });

  it('hub: the main frame sits in the middle with the others centered on each side', () => {
    const nodes = ['core', 'top', 'right', 'bottom', 'left'].flatMap((id, index) => frameWithCards(id, index * 2000, 0, 2));
    const { plan, byId } = apply(nodes, { preset: 'hub', startX: 0, startY: 0 });
    const core = byId.get('core')!;
    const centerX = (id: string) => byId.get(id)!.x + byId.get(id)!.width / 2;
    const centerY = (id: string) => byId.get(id)!.y + byId.get(id)!.height / 2;

    expect(plan.roles.core).toBe('overview');
    expect(byId.get('top')!.y + byId.get('top')!.height).toBeLessThan(core.y);
    expect(byId.get('bottom')!.y).toBeGreaterThan(core.y + core.height);
    expect(byId.get('left')!.x + byId.get('left')!.width).toBeLessThan(core.x);
    expect(byId.get('right')!.x).toBeGreaterThan(core.x + core.width);
    expect(Math.abs(centerX('top') - centerX('core'))).toBeLessThanOrEqual(1);
    expect(Math.abs(centerY('left') - centerY('core'))).toBeLessThanOrEqual(1);
    expect(buildLayoutSnapshot(nodes).overlaps).toEqual([]);
  });

  it('spotlight: the lead frame on the left, the others in one aligned column on the right', () => {
    const nodes = ['lead', 'a', 'b', 'c'].flatMap((id, index) => frameWithCards(id, index * 2000, 0, id === 'lead' ? 4 : 1 + index));
    const { byId } = apply(nodes, { preset: 'spotlight', startX: 0, startY: 0 });
    const lead = byId.get('lead')!;

    for (const id of ['a', 'b', 'c']) {
      expect(byId.get(id)!.x).toBeGreaterThan(lead.x + lead.width);
      expect(byId.get(id)!.x).toBe(byId.get('a')!.x);
      expect(byId.get(id)!.width).toBe(byId.get('a')!.width);
    }
    expect(byId.get('a')!.y).toBe(lead.y);
    expect(byId.get('b')!.y).toBeGreaterThan(byId.get('a')!.y + byId.get('a')!.height);
    expect(buildLayoutSnapshot(nodes).overlaps).toEqual([]);
  });

  it('masonry: each frame goes to the shortest column', () => {
    const nodes = [
      ...frameWithCards('tall', 0, 0, 4),
      ...frameWithCards('short-1', 2000, 0, 1),
      ...frameWithCards('short-2', 4000, 0, 1),
    ];
    const { byId } = apply(nodes, { preset: 'masonry', startX: 0, startY: 0 });

    expect(byId.get('short-1')!.y).toBe(byId.get('tall')!.y);
    expect(byId.get('short-1')!.x).toBeGreaterThan(byId.get('tall')!.x);
    // The second column is the shorter one, so the next frame stacks under it.
    expect(byId.get('short-2')!.x).toBe(byId.get('short-1')!.x);
    expect(byId.get('short-2')!.y).toBeGreaterThan(byId.get('short-1')!.y + byId.get('short-1')!.height);
    expect(buildLayoutSnapshot(nodes).overlaps).toEqual([]);
  });

  it('rejects ids that are not frames', () => {
    const nodes = [node('card', 0, 0, 100, 100)];
    expect(() => planLayoutPreset(nodes, { preset: 'flow', frameIds: ['card'] })).toThrow('Frame not found: card');
  });
});
