/**
 * Pure helpers for canvas memory recall ranking / record phrasing.
 *
 * Kept free of any runtime dependency on `pulse-coder-memory-plugin` (only a
 * type-only import) so this logic — the most bug-prone part — can be unit
 * tested without loading the plugin's native (better-sqlite3) module graph.
 */

import type { MemoryItem } from 'pulse-coder-memory-plugin';

export type MemoryGranularity = 'session' | 'workspace' | 'global' | 'all';
export type MemoryOrigin = 'session' | 'workspace' | 'global';
export type WorkspaceRecordKind = 'preference' | 'rule' | 'fix' | 'profile';
export type GlobalRecordKind = 'rule' | 'profile';

export const DEFAULT_RECALL_LIMIT = 6;
export const MAX_RECALL_LIMIT = 8;

/** Relative preference between buckets when merging cross-granularity results. */
export const ORIGIN_WEIGHT: Record<MemoryOrigin, number> = {
  session: 1,
  workspace: 0.8,
  global: 0.6,
};

export interface RankedMemoryEntry {
  origin: MemoryOrigin;
  item: MemoryItem;
  /** Heuristic score: bucket weight decayed by in-bucket rank position. */
  score: number;
}

export interface RecalledMemory {
  origin: MemoryOrigin;
  item: MemoryItem;
}

export function clampRecallLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_RECALL_LIMIT;
  return Math.min(MAX_RECALL_LIMIT, Math.max(1, Math.round(value)));
}

/** Bucket weight decayed by the item's 0-based rank within its bucket. */
export function bucketScore(origin: MemoryOrigin, rank: number): number {
  return ORIGIN_WEIGHT[origin] / (1 + Math.max(0, rank));
}

/**
 * Keyword overlap test used to surface explicit (non-daily-log) records, which
 * the plugin's semantic `recall()` does not search. Pure / testable.
 */
export function keywordMatches(
  query: string,
  item: Pick<MemoryItem, 'summary' | 'content' | 'keywords'>,
): boolean {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const haystack = `${item.summary} ${item.content} ${item.keywords.join(' ')}`.toLowerCase();
  return tokens.some((token) => haystack.includes(token));
}

/**
 * Dedup by item id (keeping the highest-scoring origin), then sort: pinned
 * first, then score, then recency. Caps to `limit`.
 */
export function mergeRankedMemories(entries: RankedMemoryEntry[], limit: number): RecalledMemory[] {
  const byId = new Map<string, RankedMemoryEntry>();
  for (const entry of entries) {
    const existing = byId.get(entry.item.id);
    if (!existing || entry.score > existing.score) {
      byId.set(entry.item.id, entry);
    }
  }

  return [...byId.values()]
    .sort((a, b) => {
      if (a.item.pinned !== b.item.pinned) return a.item.pinned ? -1 : 1;
      if (b.score !== a.score) return b.score - a.score;
      return b.item.updatedAt - a.item.updatedAt;
    })
    .slice(0, clampRecallLimit(limit))
    .map(({ origin, item }) => ({ origin, item }));
}

/**
 * Mirror the memory plugin's record phrasing so its extraction stage classifies
 * scope/type consistently (rule/profile → user-level; preference/fix → session).
 */
export function toRecordPayload(
  content: string,
  kind: WorkspaceRecordKind,
): { userText: string; assistantText: string } {
  const c = content.trim();
  switch (kind) {
    case 'rule':
      return { userText: `Rule: must follow this constraint. ${c}`, assistantText: 'Acknowledged.' };
    case 'fix':
      return { userText: `Issue context: ${c}`, assistantText: `Fixed and resolved: ${c}` };
    case 'profile':
      return { userText: `Profile: ${c}`, assistantText: 'Profile captured.' };
    case 'preference':
    default:
      return { userText: `Remember this preference for later: ${c}`, assistantText: 'Noted.' };
  }
}
