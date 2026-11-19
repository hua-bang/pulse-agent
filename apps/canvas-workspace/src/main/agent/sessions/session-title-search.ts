/**
 * Keyword lookup over session TITLES — the stored list preview (first user
 * message, truncated like the session rail), any user-given title, and the
 * workspace name. Powers the chat composer's @-mention popup, which only
 * surfaces sessions when the user has typed a query — so an empty/blank
 * query returns nothing by design.
 *
 * Deliberately NOT a full-content search: this runs on every keystroke
 * after `@`, so it reads only the list metadata the session rail already
 * uses (SQLite conversation headers / the legacy metadata index) and never
 * loads message bodies. Deep content search is the agent-side
 * `session_search` tool's job. (Extracted from service.ts for the 500-line
 * governance gate.)
 *
 * `searchSessionContent` is the one exception: the chat sessions rail calls
 * it after the user pauses typing, so it may read message bodies. It only
 * returns which sessions match; the rail keeps its own rows.
 */

import { GLOBAL_CHAT_SESSION_STORE_ID, GLOBAL_CHAT_WORKSPACE_NAME, workspaceNames } from './store/session-store-lookups';
import { scanAllWorkspaceSessions } from './store/session-store-scan';
import { readAllSessionsWithMeta } from './store/session-store-lookups';
import { sessionPreviewForMessage } from './session-preview';
import { sessionStorageRoot } from './sqlite/backend';
import type { SessionSearchHit } from '../types';

export async function searchSessionTitles(query: string, limit = 8): Promise<SessionSearchHit[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const root = sessionStorageRoot();
  const [groups, names] = await Promise.all([scanAllWorkspaceSessions(root), workspaceNames(root)]);
  const candidates = groups.flatMap(({ workspaceId, sessions }) => {
    const workspaceName = workspaceId === GLOBAL_CHAT_SESSION_STORE_ID
      ? GLOBAL_CHAT_WORKSPACE_NAME
      : names.get(workspaceId) ?? workspaceId;
    return sessions.map(session => ({ workspaceId, workspaceName, session }));
  });
  // Most relevant first: live sessions, then most recently updated.
  candidates.sort((left, right) => Number(right.session.isCurrent) - Number(left.session.isCurrent)
    || right.session.updatedAt - left.session.updatedAt);

  const hits: SessionSearchHit[] = [];
  for (const { workspaceId, workspaceName, session } of candidates) {
    const preview = session.preview.replace(/\s+/g, ' ').trim();
    const haystack = `${preview}\n${session.title ?? ''}\n${workspaceName}`.toLowerCase();
    if (!haystack.includes(normalized)) continue;

    hits.push({
      sessionId: session.sessionId,
      workspaceId,
      workspaceName,
      date: session.date,
      isCurrent: session.isCurrent,
      messageCount: session.messageCount,
      preview,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * Sessions whose user or assistant messages contain `query`
 * (case-insensitive), current sessions first, then newest.
 */
export async function searchSessionContent(query: string, limit = 50): Promise<SessionSearchHit[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const entries = await readAllSessionsWithMeta(sessionStorageRoot());
  entries.sort((left, right) => Number(right.isCurrent) - Number(left.isCurrent)
    || right.sortKey - left.sortKey);

  const hits: SessionSearchHit[] = [];
  for (const { session, workspaceName, isCurrent } of entries) {
    const messages = session.messages ?? [];
    const matches = messages.some((message) => (
      (message.role === 'user' || message.role === 'assistant')
      && typeof message.content === 'string'
      && message.content.toLowerCase().includes(normalized)
    ));
    if (!matches) continue;

    const firstUser = messages.find((message) => message.role === 'user');
    hits.push({
      sessionId: session.sessionId,
      workspaceId: session.workspaceId,
      workspaceName,
      date: session.startedAt?.slice(0, 10) ?? '',
      isCurrent,
      messageCount: messages.length,
      preview: sessionPreviewForMessage(firstUser),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
