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
  messageCount: number;
  preview: string;
  title?: string;
  pinned: boolean;
  isCurrent: boolean;
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
    const sessionsDir = join(rootDir, dir, 'agent-sessions');
    const archiveDir = join(sessionsDir, 'archive');
    const metadata = await readSessionMetadata(join(sessionsDir, 'metadata.json'));
    const sessions: AgentSessionListEntry[] = [];

    try {
      const raw = await fs.readFile(join(sessionsDir, 'current.json'), 'utf-8');
      const data = JSON.parse(raw) as CanvasAgentSession;
      if (data.messages?.length > 0) {
        const firstUserMessage = data.messages.find((message) => message.role === 'user');
        sessions.push({
          sessionId: data.sessionId,
          date: data.startedAt?.slice(0, 10) || '',
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
      return right.date.localeCompare(left.date);
    });
    results.push({ workspaceId: dir, sessions });
  }
  return results;
}
