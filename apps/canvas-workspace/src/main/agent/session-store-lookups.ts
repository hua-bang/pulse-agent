import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { GLOBAL_CHAT_STORE_ID, isListableSessionStore } from '../../shared/agent-chat';
import type { CanvasAgentSession } from './types';
import { archiveSortKey, isListableSession } from './session-file-summary';
import { decodeSession } from './sqlite-session-codec';
import { getSqliteSessionStorage, listSqliteConversations, listSqliteSessionScopes } from './sqlite-session-backend';

export const GLOBAL_CHAT_SESSION_STORE_ID = GLOBAL_CHAT_STORE_ID;
export const GLOBAL_CHAT_WORKSPACE_NAME = 'No workspace';

export interface SessionWithMeta {
  session: CanvasAgentSession;
  workspaceName: string;
  isCurrent: boolean;
  sortKey: number;
}

export async function readCurrentSessionId(root: string, storeId: string): Promise<string | null> {
  const storage = await getSqliteSessionStorage(root);
  if (storage) return (await storage.conversationScopes.read(storeId))?.currentSessionId ?? null;
  try {
    const data = JSON.parse(await fs.readFile(join(root, storeId, 'agent-sessions', 'current.json'), 'utf8')) as CanvasAgentSession;
    return data.sessionId ?? null;
  } catch { return null; }
}

export async function readSessionFromWorkspace(root: string, storeId: string, sessionId: string): Promise<CanvasAgentSession | null> {
  const storage = await getSqliteSessionStorage(root);
  if (storage) {
    const record = await storage.conversations.read(storeId, sessionId);
    return record ? decodeSession(record) : null;
  }
  const sessionsDir = join(root, storeId, 'agent-sessions');
  try {
    const session = JSON.parse(await fs.readFile(join(sessionsDir, 'current.json'), 'utf8')) as CanvasAgentSession;
    if (session.sessionId === sessionId) return session;
  } catch { /* Legacy lookup tolerates absent current history. */ }
  let matched: CanvasAgentSession | null = null;
  let matchedSortKey = -1;
  try {
    const archiveDir = join(sessionsDir, 'archive');
    for (const file of await fs.readdir(archiveDir)) {
      if (!file.endsWith('.json')) continue;
      const path = join(archiveDir, file);
      const session = JSON.parse(await fs.readFile(path, 'utf8')) as CanvasAgentSession;
      if (session.sessionId !== sessionId) continue;
      const sortKey = await archiveSortKey(path, file);
      if (!matched || sortKey > matchedSortKey) { matched = session; matchedSortKey = sortKey; }
    }
  } catch { /* Preserve the legacy best-effort archive lookup. */ }
  return matched;
}

async function workspaceNames(root: string): Promise<Map<string, string>> {
  try {
    const manifest = JSON.parse(await fs.readFile(join(root, '__workspaces__.json'), 'utf8')) as {
      workspaces?: Array<{ id: string; name: string }>;
      entries?: Array<{ id: string; name: string }>;
    };
    return new Map((manifest.workspaces ?? manifest.entries ?? []).map(workspace => [workspace.id, workspace.name]));
  } catch { return new Map(); }
}

export async function readAllSessionsWithMeta(root: string): Promise<SessionWithMeta[]> {
  const names = await workspaceNames(root);
  const nameFor = (id: string) => id === GLOBAL_CHAT_STORE_ID ? GLOBAL_CHAT_WORKSPACE_NAME : names.get(id) ?? id;
  const results: SessionWithMeta[] = [];
  const storage = await getSqliteSessionStorage(root);
  if (storage) {
    for (const scope of await listSqliteSessionScopes(storage)) {
      if (!isListableSessionStore(scope.scopeId)) continue;
      for (const header of await listSqliteConversations(storage, scope.scopeId)) {
        if (Number(header.metadata.messageCount ?? 0) === 0) continue;
        const record = await storage.conversations.read(scope.scopeId, header.sessionId);
        if (!record) continue;
        const current = scope.currentSessionId === record.sessionId;
        results.push({
          session: decodeSession(record), workspaceName: nameFor(scope.scopeId), isCurrent: current,
          sortKey: current ? Date.now() : Number(record.metadata.sortKey ?? record.metadata.updatedAt ?? 0),
        });
      }
    }
  } else {
    const dirs = await fs.readdir(root).catch(() => [] as string[]);
    for (const storeId of dirs) {
      if (!isListableSessionStore(storeId)) continue;
      const directory = join(root, storeId, 'agent-sessions');
      const seen = new Set<string>();
      try {
        const session = JSON.parse(await fs.readFile(join(directory, 'current.json'), 'utf8')) as CanvasAgentSession;
        seen.add(session.sessionId);
        if (isListableSession(session)) results.push({ session, workspaceName: nameFor(storeId), isCurrent: true, sortKey: Date.now() });
      } catch { /* No current session. */ }
      const archives = await fs.readdir(join(directory, 'archive')).catch(() => [] as string[]);
      for (const file of archives) {
        if (!file.endsWith('.json')) continue;
        const path = join(directory, 'archive', file);
        try {
          const session = JSON.parse(await fs.readFile(path, 'utf8')) as CanvasAgentSession;
          if (!isListableSession(session) || seen.has(session.sessionId)) continue;
          seen.add(session.sessionId);
          results.push({ session, workspaceName: nameFor(storeId), isCurrent: false, sortKey: await archiveSortKey(path, file) });
        } catch { /* Skip corrupted legacy archives in best-effort history tools. */ }
      }
    }
  }
  return results.sort((left, right) => right.sortKey - left.sortKey);
}
