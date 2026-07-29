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
 */

import { SessionStore } from './session-store';
import { sessionPreview } from './session-preview';
import type { SessionSearchHit } from './types';

export async function searchSessionTitles(query: string, limit = 8): Promise<SessionSearchHit[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const hits: SessionSearchHit[] = [];
  for (const entry of await SessionStore.readAllSessionsWithMeta()) {
    const { session } = entry;
    const firstUserMsg = session.messages.find(m => m.role === 'user');
    const title = firstUserMsg ? firstUserMsg.content.replace(/\s+/g, ' ').trim() : '';
    const haystack = `${title}\n${entry.workspaceName}`.toLowerCase();
    if (!haystack.includes(normalized)) continue;

    hits.push({
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      workspaceName: entry.workspaceName,
      date: session.startedAt?.slice(0, 10) ?? '',
      isCurrent: entry.isCurrent,
      messageCount: session.messages.length,
      preview: sessionPreview(title, 60),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
