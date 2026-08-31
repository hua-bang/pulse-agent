import { promises as fs } from 'fs';
import type { CanvasAgentSession } from './types';

export interface AgentSessionListEntry {
  sessionId: string;
  date: string;
  updatedAt: number;
  messageCount: number;
  preview: string;
  title?: string;
  pinned: boolean;
  isCurrent: boolean;
}

export const isListableSession = (session: CanvasAgentSession): boolean =>
  Array.isArray(session.messages) && session.messages.length > 0;

export function sessionUpdatedAt(session: CanvasAgentSession, fileTimestamp = 0): number {
  const messageTimestamp = (session.messages ?? []).reduce(
    (latest, message) => Number.isFinite(message.timestamp)
      ? Math.max(latest, message.timestamp ?? 0)
      : latest,
    0,
  );
  if (messageTimestamp > 0) return messageTimestamp;
  const startedAt = Date.parse(session.startedAt ?? '');
  return Number.isFinite(startedAt) ? startedAt : fileTimestamp;
}

function archiveFileTimestamp(file: string): number {
  const match = file.match(/-(\d+)\.json$/);
  return match ? Number(match[1]) : 0;
}

export async function archiveSortKey(filePath: string, fileName: string): Promise<number> {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch {
    return archiveFileTimestamp(fileName);
  }
}
