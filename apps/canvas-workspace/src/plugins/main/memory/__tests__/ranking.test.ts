import { describe, expect, it } from 'vitest';
import type { MemoryItem } from 'pulse-coder-memory-plugin';
import {
  bucketScore,
  clampRecallLimit,
  keywordMatches,
  mergeRankedMemories,
  toRecordPayload,
  type RankedMemoryEntry,
} from '../ranking';

function makeItem(over: Partial<MemoryItem> & { id: string }): MemoryItem {
  return {
    platformKey: 'canvas:ws:w1',
    scope: 'session',
    type: 'fact',
    content: 'content',
    summary: 'summary',
    keywords: [],
    confidence: 0.5,
    importance: 0.5,
    pinned: false,
    deleted: false,
    createdAt: 0,
    updatedAt: 0,
    lastAccessedAt: 0,
    ...over,
  } as MemoryItem;
}

describe('bucketScore', () => {
  it('weights by origin and decays by in-bucket rank', () => {
    expect(bucketScore('session', 0)).toBeCloseTo(1);
    expect(bucketScore('workspace', 0)).toBeCloseTo(0.8);
    expect(bucketScore('global', 0)).toBeCloseTo(0.6);
    expect(bucketScore('session', 1)).toBeCloseTo(0.5);
  });
});

describe('clampRecallLimit', () => {
  it('defaults / clamps into 1..8', () => {
    expect(clampRecallLimit(undefined)).toBe(6);
    expect(clampRecallLimit(100)).toBe(8);
    expect(clampRecallLimit(0)).toBe(1);
    expect(clampRecallLimit(3)).toBe(3);
  });
});

describe('mergeRankedMemories', () => {
  it('dedups by id (keeping the higher-scoring origin), pins first, sorts by score, caps', () => {
    const entries: RankedMemoryEntry[] = [
      { origin: 'global', item: makeItem({ id: 'a', updatedAt: 10 }), score: 0.6 },
      { origin: 'session', item: makeItem({ id: 'a', updatedAt: 10 }), score: 0.9 },
      { origin: 'workspace', item: makeItem({ id: 'b', updatedAt: 5, pinned: true }), score: 0.8 },
      { origin: 'session', item: makeItem({ id: 'c', updatedAt: 1 }), score: 0.95 },
    ];

    const merged = mergeRankedMemories(entries, 10);
    expect(merged.map((m) => m.item.id)).toEqual(['b', 'c', 'a']);
    // 'a' deduped to its higher-scoring (session) origin.
    expect(merged.find((m) => m.item.id === 'a')?.origin).toBe('session');
  });

  it('respects the limit', () => {
    const entries: RankedMemoryEntry[] = [
      { origin: 'workspace', item: makeItem({ id: 'a' }), score: 0.9 },
      { origin: 'workspace', item: makeItem({ id: 'b' }), score: 0.8 },
      { origin: 'workspace', item: makeItem({ id: 'c' }), score: 0.7 },
    ];
    expect(mergeRankedMemories(entries, 2).map((m) => m.item.id)).toEqual(['a', 'b']);
  });
});

describe('keywordMatches', () => {
  const item = { summary: 'use pnpm', content: 'We decided to use pnpm', keywords: ['tooling'] };
  it('matches when any query token appears in summary/content/keywords', () => {
    expect(keywordMatches('pnpm', item)).toBe(true);
    expect(keywordMatches('tooling setup', item)).toBe(true);
    expect(keywordMatches('yarn', item)).toBe(false);
    expect(keywordMatches('   ', item)).toBe(false);
  });
});

describe('toRecordPayload', () => {
  it('phrases each kind so plugin extraction classifies it consistently', () => {
    expect(toRecordPayload('x', 'rule').userText).toMatch(/^Rule:/);
    expect(toRecordPayload('x', 'fix').assistantText).toMatch(/Fixed and resolved/);
    expect(toRecordPayload('x', 'profile').userText).toMatch(/^Profile:/);
    expect(toRecordPayload('x', 'preference').userText).toMatch(/preference/);
  });
});
