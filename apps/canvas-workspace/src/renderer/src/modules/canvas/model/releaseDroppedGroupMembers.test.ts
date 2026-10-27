import { describe, expect, it } from 'vitest';
import type { CanvasNode, GroupNodeData } from '../../../types';
import { releaseDroppedGroupMembers } from './releaseDroppedGroupMembers';

const node = (
  id: string,
  type: CanvasNode['type'],
  x: number,
  y: number,
  width = 100,
  height = 100,
  data: Record<string, unknown> = {},
): CanvasNode => ({
  id, type, title: id, x, y, width, height, data: data as unknown as CanvasNode['data'],
});

const childIdsOf = (nodes: CanvasNode[], id: string) =>
  (nodes.find((n) => n.id === id)!.data as GroupNodeData).childIds;

describe('releaseDroppedGroupMembers', () => {
  const card = node('card', 'text', 20, 20);
  const other = node('other', 'text', 140, 20);
  const group = node('group', 'group', 0, 0, 260, 140, { childIds: ['card', 'other'] });
  const frame = node('frame', 'frame', 600, 0, 400, 300);

  it('removes a member dropped into a frame outside its group', () => {
    const before = [group, card, other, frame];
    const after = before.map((n) => (n.id === 'card' ? { ...n, x: 700, y: 50 } : n));
    const next = releaseDroppedGroupMembers(before, after, new Set(['card']));
    expect(childIdsOf(next, 'group')).toEqual(['other']);
  });

  it('keeps membership when the member lands on empty canvas', () => {
    const before = [group, card, other, frame];
    const after = before.map((n) => (n.id === 'card' ? { ...n, x: 300, y: 400 } : n));
    expect(releaseDroppedGroupMembers(before, after, new Set(['card']))).toBe(after);
  });

  it('keeps members when the whole group moves into a frame', () => {
    const before = [group, card, other, frame];
    const moved = new Set(['group', 'card', 'other']);
    const after = before.map((n) => (moved.has(n.id) ? { ...n, x: n.x + 650, y: n.y + 50 } : n));
    expect(releaseDroppedGroupMembers(before, after, moved)).toBe(after);
  });

  it('keeps membership for a frame that already sits in the group', () => {
    const inner = node('inner', 'frame', 10, 160, 200, 200);
    const big = node('group', 'group', 0, 0, 300, 400, { childIds: ['card', 'inner'] });
    const before = [big, card, inner];
    const after = before.map((n) => (n.id === 'card' ? { ...n, x: 60, y: 200 } : n));
    expect(releaseDroppedGroupMembers(before, after, new Set(['card']))).toBe(after);
  });
});
