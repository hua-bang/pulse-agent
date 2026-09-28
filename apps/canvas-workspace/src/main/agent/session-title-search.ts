/**
 * Keyword lookup over session TITLES — the first user message (the same
 * text the session rail shows as preview) plus the workspace name. Powers
 * the chat composer's @-mention popup, which only surfaces sessions when
 * the user has typed a query — so an empty/blank query returns nothing by
 * design.
 *
 * Deliberately NOT a full-content search: this runs on every keystroke
 * after `@`, so it stays cheap and predictable. Deep content search is the
 * agent-side `session_search` tool's job. (Extracted from service.ts for
 * the 500-line governance gate.)
 *
 * Building the index reads and decodes every stored session, which is far
 * too slow to repeat per keystroke. The index is therefore cached briefly:
 * one `@` query burst reuses a single scan, and a new session shows up at
 * most `INDEX_TTL_MS` later.
 */

import { SessionStore } from './session-store';
import { sessionPreview } from './session-preview';
import type { SessionSearchHit } from './types';

const INDEX_TTL_MS = 10_000;

interface TitleIndexEntry {
  haystack: string;
  hit: SessionSearchHit;
}

let cachedIndex: { expiresAt: number; entries: TitleIndexEntry[] } | null = null;
let pendingIndex: Promise<TitleIndexEntry[]> | null = null;

async function buildTitleIndex(): Promise<TitleIndexEntry[]> {
  const entries: TitleIndexEntry[] = [];
  for (const entry of await SessionStore.readAllSessionsWithMeta()) {
    const { session } = entry;
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    const title = firstUserMsg ? firstUserMsg.content.replace(/\s+/g, ' ').trim() : '';
    entries.push({
      haystack: `${title}\n${entry.workspaceName}`.toLowerCase(),
      hit: {
        sessionId: session.sessionId,
        workspaceId: session.workspaceId,
        workspaceName: entry.workspaceName,
        date: session.startedAt?.slice(0, 10) ?? '',
        isCurrent: entry.isCurrent,
        messageCount: session.messages.length,
        preview: sessionPreview(title, 60),
      },
    });
  }
  return entries;
}

function loadTitleIndex(): Promise<TitleIndexEntry[]> {
  if (cachedIndex && cachedIndex.expiresAt > Date.now()) return Promise.resolve(cachedIndex.entries);
  // Keystrokes that arrive mid-scan share the one in-flight read.
  if (!pendingIndex) {
    pendingIndex = buildTitleIndex().then((entries) => {
      cachedIndex = { expiresAt: Date.now() + INDEX_TTL_MS, entries };
      return entries;
    }).finally(() => {
      pendingIndex = null;
    });
  }
  return pendingIndex;
}

export async function searchSessionTitles(query: string, limit = 8): Promise<SessionSearchHit[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const hits: SessionSearchHit[] = [];
  for (const { haystack, hit } of await loadTitleIndex()) {
    if (!haystack.includes(normalized)) continue;
    hits.push({ ...hit });
    if (hits.length >= limit) break;
  }
  return hits;
}

export function resetSessionTitleSearchForTests(): void {
  cachedIndex = null;
  pendingIndex = null;
}
