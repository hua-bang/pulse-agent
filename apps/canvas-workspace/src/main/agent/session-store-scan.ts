import { promises as fs } from 'fs';
import { join } from 'path';
import { isListableSessionStore } from '../../shared/agent-chat';
import type { CanvasAgentSession } from './types';
import { sessionPreview } from './session-preview';
import {
  listedSessionMetadata,
  readSessionMetadata,
} from './session-metadata';

export interface AgentSessionListEntry {
  sessionId: string;
  date: string;
  /** Exact recency used by the rail; unlike `date`, retains time-of-day. */
  updatedAt: number;
  messageCount: number;
  preview: string;
  title?: string;
  pinned: boolean;
  isCurrent: boolean;
}

export function sessionUpdatedAt(session: CanvasAgentSession, fileTimestamp = 0): number {
  const messageTimestamp = (session.messages ?? []).reduce(
    (latest, message) => Number.isFinite(message.timestamp)
      ? Math.max(latest, message.timestamp ?? 0)
      : latest,
    0,
  );
  // File mtimes are only a fallback: imports and harness clones legitimately
  // rewrite them, which must not make every historical conversation "just now".
  if (messageTimestamp > 0) return messageTimestamp;
  const startedAt = Date.parse(session.startedAt ?? '');
  if (Number.isFinite(startedAt)) return startedAt;
  return fileTimestamp;
}

function archiveFileTimestamp(file: string): number {
  const match = file.match(/-(\d+)\.json$/);
  return match ? Number(match[1]) : 0;
}

export async function archiveSortKey(filePath: string, fileName: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return archiveFileTimestamp(fileName);
  }
}

export async function scanAllWorkspaceSessions(
  rootDir: string,
  excludedStoreIds: ReadonlySet<string> = new Set(),
): Promise<Array<{ workspaceId: string; sessions: AgentSessionListEntry[] }>> {
  const results: Array<{ workspaceId: string; sessions: AgentSessionListEntry[] }> = [];
  let dirs: string[];
  try {
    dirs = await fs.readdir(rootDir);
  } catch {
    return results;
  }

  for (const dir of dirs) {
    if (!isListableSessionStore(dir)) continue;
    if (excludedStoreIds.has(dir)) continue;
    const sessionsDir = join(rootDir, dir, 'agent-sessions');
    const archiveDir = join(sessionsDir, 'archive');
    const metadata = await readSessionMetadata(join(sessionsDir, 'metadata.json'));
    const sessions: AgentSessionListEntry[] = [];

    try {
      const currentPath = join(sessionsDir, 'current.json');
      const raw = await fs.readFile(currentPath, 'utf-8');
      const data = JSON.parse(raw) as CanvasAgentSession;
      if (data.messages?.length > 0) {
        const firstUserMessage = data.messages.find((message) => message.role === 'user');
        sessions.push({
          sessionId: data.sessionId,
          date: data.startedAt?.slice(0, 10) || '',
          updatedAt: sessionUpdatedAt(data, await archiveSortKey(currentPath, '')),
          messageCount: data.messages.length,
          preview: firstUserMessage ? sessionPreview(firstUserMessage.content) : '',
          ...listedSessionMetadata(metadata, data.sessionId),
          isCurrent: true,
        });
      }
    } catch {
      // No current session.
    }

    try {
      const files = await fs.readdir(archiveDir);
      const currentIds = new Set(sessions.map((session) => session.sessionId));
      const archivedById = new Map<string, AgentSessionListEntry & { sortKey: number }>();
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const archivePath = join(archiveDir, file);
          const raw = await fs.readFile(archivePath, 'utf-8');
          const data = JSON.parse(raw) as CanvasAgentSession;
          if (currentIds.has(data.sessionId)) continue;
          const firstUserMessage = data.messages.find((message) => message.role === 'user');
          const sortKey = await archiveSortKey(archivePath, file);
          const session = {
            sessionId: data.sessionId,
            date: data.startedAt?.slice(0, 10) || file.replace('.json', '').slice(0, 10),
            updatedAt: sessionUpdatedAt(data, sortKey),
            messageCount: data.messages.length,
            preview: firstUserMessage ? sessionPreview(firstUserMessage.content) : '',
            ...listedSessionMetadata(metadata, data.sessionId),
            isCurrent: false,
            sortKey,
          };
          const existing = archivedById.get(data.sessionId);
          if (!existing || sortKey > existing.sortKey) archivedById.set(data.sessionId, session);
        } catch {
          // Skip corrupted archives.
        }
      }
      sessions.push(...Array.from(archivedById.values())
        .map(({ sortKey: _sortKey, ...session }) => session));
    } catch {
      // No archive directory.
    }

    if (sessions.length === 0) continue;
    sessions.sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
      return right.updatedAt - left.updatedAt || right.date.localeCompare(left.date);
    });
    results.push({ workspaceId: dir, sessions });
  }
  return results;
}
