import { promises as fs } from 'fs';
import { join } from 'path';
import { GLOBAL_CHAT_STORE_ID, isListableSessionStore, scheduledTaskIdFromStoreId } from '../../shared/agent-chat';
import { listIndexedSessions } from './session-index';
import type { AgentSessionListEntry } from './session-file-summary';
import { getSqliteSessionStorage, listSqliteConversations, listSqliteSessionScopes } from './sqlite-session-backend';
import { sessionListEntry } from './sqlite-session-codec';

export { archiveSortKey, isListableSession, sessionUpdatedAt, type AgentSessionListEntry } from './session-file-summary';

export async function scanAllWorkspaceSessions(
  rootDir: string,
  excludedStoreIds: ReadonlySet<string> = new Set(),
  visibleWorkspaceIds?: ReadonlySet<string>,
): Promise<Array<{ workspaceId: string; sessions: AgentSessionListEntry[] }>> {
  const storage = await getSqliteSessionStorage(rootDir);
  if (storage) {
    const scopes = (await listSqliteSessionScopes(storage)).filter(scope =>
      isListableSessionStore(scope.scopeId) && !excludedStoreIds.has(scope.scopeId)
      && (!visibleWorkspaceIds || visibleWorkspaceIds.has(scope.scopeId)
        || scope.scopeId === GLOBAL_CHAT_STORE_ID || Boolean(scheduledTaskIdFromStoreId(scope.scopeId))),
    );
    const groups = await Promise.all(scopes.map(async scope => ({
      workspaceId: scope.scopeId,
      sessions: (await listSqliteConversations(storage, scope.scopeId))
        .map(record => sessionListEntry(record, scope.currentSessionId)).filter(session => session.messageCount > 0)
        .sort((left, right) => Number(right.isCurrent) - Number(left.isCurrent) || right.updatedAt - left.updatedAt),
    })));
    return groups.filter(group => group.sessions.length > 0);
  }
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const storeIds = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(dir => isListableSessionStore(dir) && !excludedStoreIds.has(dir))
    // The rail manifest is authoritative; leftover directories are history, not workspaces.
    .filter(dir => !visibleWorkspaceIds || visibleWorkspaceIds.has(dir)
      || dir === GLOBAL_CHAT_STORE_ID || Boolean(scheduledTaskIdFromStoreId(dir)));
  const groups = await Promise.all(storeIds.map(async (workspaceId) => {
    const sessionsDir = join(rootDir, workspaceId, 'agent-sessions');
    const sessions = await listIndexedSessions(sessionsDir, join(sessionsDir, 'metadata.json'));
    return sessions.length > 0 ? { workspaceId, sessions } : null;
  }));
  return groups.filter((group): group is { workspaceId: string; sessions: AgentSessionListEntry[] } => group !== null);
}
