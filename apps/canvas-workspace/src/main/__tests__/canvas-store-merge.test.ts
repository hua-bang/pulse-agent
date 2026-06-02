import { describe, it, expect } from 'vitest';
import {
  decideNodeMerge,
  type MergeNode,
  type NodeMergeDecision,
} from '../canvas/node-merge';

/** Build a node with just the fields the merge cares about. */
const node = (id: string, updatedAt?: number): MergeNode =>
  updatedAt === undefined ? { id } : { id, updatedAt };

const ids = (decision: NodeMergeDecision<MergeNode>): string[] => {
  if (decision.kind !== 'write') throw new Error(`expected write, got ${decision.kind}`);
  return decision.nodes.map((n) => n.id ?? '');
};

describe('decideNodeMerge', () => {
  describe('empty-overwrite guard', () => {
    it('preserves on-disk nodes when memory is empty and caller is not authoritative', () => {
      const decision = decideNodeMerge([], [node('a'), node('b')], new Set(['a', 'b']));
      expect(decision.kind).toBe('preserve-disk');
    });

    it('honors a delete-all when the caller is authoritative', () => {
      const decision = decideNodeMerge(
        [],
        [node('a'), node('b')],
        new Set(['a', 'b']),
        { authoritative: true },
      );
      expect(decision.kind).toBe('write');
      expect(ids(decision)).toEqual([]);
    });

    it('writes empty when both memory and disk are empty (nothing to guard)', () => {
      const decision = decideNodeMerge([], [], new Set());
      expect(decision).toEqual({ kind: 'write', nodes: [], shrinkPreserved: undefined });
    });
  });

  describe('normal small delete', () => {
    it('drops a known node that is gone from memory (deletion persists), both modes', () => {
      const disk = [node('a'), node('b'), node('c')];
      const known = new Set(['a', 'b', 'c']);
      // user deleted 'b'
      const memory = [node('a'), node('c')];

      for (const authoritative of [false, true]) {
        const decision = decideNodeMerge(memory, disk, known, { authoritative });
        expect(ids(decision)).toEqual(['a', 'c']);
      }
    });
  });

  describe('Rule 1 newer-wins', () => {
    it('keeps the disk copy when it has a newer updatedAt', () => {
      const decision = decideNodeMerge(
        [node('a', 100)],
        [node('a', 200)],
        new Set(['a']),
      );
      if (decision.kind !== 'write') throw new Error('expected write');
      expect(decision.nodes[0].updatedAt).toBe(200);
    });

    it('keeps the memory copy when it is newer or equal', () => {
      const decision = decideNodeMerge(
        [node('a', 300)],
        [node('a', 200)],
        new Set(['a']),
      );
      if (decision.kind !== 'write') throw new Error('expected write');
      expect(decision.nodes[0].updatedAt).toBe(300);
    });
  });

  describe('Rule 2 CLI-create adoption', () => {
    it('adds a disk-only node whose id was never seen', () => {
      const decision = decideNodeMerge(
        [node('a')],
        [node('a'), node('cli-new')],
        new Set(['a']), // cli-new not known
      );
      expect(ids(decision)).toEqual(['a', 'cli-new']);
    });

    it('does not re-add a disk-only node whose id is known (UI deleted it)', () => {
      const decision = decideNodeMerge(
        [node('a')],
        [node('a'), node('b')],
        new Set(['a', 'b']), // b known => was deleted in UI
      );
      expect(ids(decision)).toEqual(['a']);
    });
  });

  describe('Rule 3 suspicious-shrink guard', () => {
    const disk = Array.from({ length: 10 }, (_, i) => node(`n${i}`));
    const known = new Set(disk.map((n) => n.id!));

    it('preserves missing disk nodes for a non-authoritative partial snapshot', () => {
      // memory dropped 8 of 10 known nodes — looks like a half-loaded snapshot
      const memory = [node('n0'), node('n1')];
      const decision = decideNodeMerge(memory, disk, known);
      if (decision.kind !== 'write') throw new Error('expected write');
      expect(decision.shrinkPreserved).toBeDefined();
      // all 10 survive (2 in memory + 8 preserved)
      expect(decision.nodes).toHaveLength(10);
    });

    it('honors the same bulk delete when the caller is authoritative', () => {
      const memory = [node('n0'), node('n1')];
      const decision = decideNodeMerge(memory, disk, known, { authoritative: true });
      if (decision.kind !== 'write') throw new Error('expected write');
      expect(decision.shrinkPreserved).toBeUndefined();
      expect(ids(decision)).toEqual(['n0', 'n1']);
    });
  });
});
