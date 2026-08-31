import { promises as fs } from 'fs';
import { join } from 'path';
import { isListableSessionStore } from '../../shared/agent-chat';
import { listIndexedSessions } from './session-index';
import type { AgentSessionListEntry } from './session-file-summary';

export { archiveSortKey, isListableSession, sessionUpdatedAt, type AgentSessionListEntry } from './session-file-summary';

export async function scanAllWorkspaceSessions(
  rootDir: string,
  excludedStoreIds: ReadonlySet<string> = new Set(),
): Promise<Array<{ workspaceId: string; sessions: AgentSessionListEntry[] }>> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const storeIds = entries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(dir => isListableSessionStore(dir) && !excludedStoreIds.has(dir));
  const groups = await Promise.all(storeIds.map(async (workspaceId) => {
    const sessionsDir = join(rootDir, workspaceId, 'agent-sessions');
    const sessions = await listIndexedSessions(sessionsDir, join(sessionsDir, 'metadata.json'));
    return sessions.length > 0 ? { workspaceId, sessions } : null;
  }));
  return groups.filter((group): group is { workspaceId: string; sessions: AgentSessionListEntry[] } => group !== null);
}
