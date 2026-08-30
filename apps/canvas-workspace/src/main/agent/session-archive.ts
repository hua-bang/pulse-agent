import { promises as fs } from 'fs';
import { join } from 'path';
import type { CanvasAgentSession } from './types';
import { archiveSortKey } from './session-store-scan';
import { readValidSessionFileIndex, tombstoneIndexedSessionFile, updateIndexedSessionFile } from './session-index';

export interface ResolvedArchivedSession {
  session: CanvasAgentSession | null;
  matchingPaths: string[];
}

/** Locate the newest copy and every duplicate path in one archive pass. */
export async function resolveArchivedSession(
  sessionsDir: string,
  metadataPath: string,
  sessionId: string,
): Promise<ResolvedArchivedSession> {
  const archiveDir = join(sessionsDir, 'archive');
  const indexed = await readValidSessionFileIndex(sessionsDir, metadataPath).catch((error) => {
    console.warn('[session-archive] Could not read session index; falling back to archive scan:', error);
    return null;
  });
  if (indexed) {
    const matches = Object.entries(indexed)
      .filter(([path, entry]) => path.startsWith('archive/') && entry.sessionId === sessionId)
      .sort(([, left], [, right]) => right.mtimeMs - left.mtimeMs);
    const verified: Array<{ session: CanvasAgentSession; path: string }> = [];
    let repairFailed = false;
    for (const [path] of matches) {
      let session: CanvasAgentSession;
      try {
        session = JSON.parse(await fs.readFile(join(sessionsDir, path), 'utf-8')) as CanvasAgentSession;
      } catch {
        await tombstoneIndexedSessionFile(sessionsDir, metadataPath, path).catch((error) => {
          repairFailed = true;
          console.warn('[session-archive] Could not tombstone invalid session index entry:', error);
        });
        continue;
      }
      if (session.sessionId === sessionId && Array.isArray(session.messages)) {
        verified.push({ session, path: join(sessionsDir, path) });
      } else if (session.sessionId && Array.isArray(session.messages)) {
        await updateIndexedSessionFile(sessionsDir, metadataPath, path, session).catch((error) => {
          repairFailed = true;
          console.warn('[session-archive] Could not repair session index identity:', error);
        });
      } else {
        await tombstoneIndexedSessionFile(sessionsDir, metadataPath, path).catch((error) => {
          repairFailed = true;
          console.warn('[session-archive] Could not tombstone malformed session index entry:', error);
        });
      }
    }
    if (!repairFailed && verified.length > 0) {
      return { session: verified[0].session, matchingPaths: verified.map(match => match.path) };
    }
  }
  let session: CanvasAgentSession | null = null;
  let matchedSortKey = -1;
  const matchingPaths: string[] = [];
  const files = await fs.readdir(archiveDir).catch(() => [] as string[]);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const archivePath = join(archiveDir, file);
    let data: CanvasAgentSession;
    try {
      data = JSON.parse(await fs.readFile(archivePath, 'utf-8')) as CanvasAgentSession;
    } catch {
      continue;
    }
    if (data.sessionId !== sessionId) continue;
    matchingPaths.push(archivePath);
    const sortKey = await archiveSortKey(archivePath, file);
    if (!session || sortKey > matchedSortKey) {
      session = data;
      matchedSortKey = sortKey;
    }
  }
  return { session, matchingPaths };
}

export async function removeArchivePaths(paths: string[]): Promise<void> {
  await Promise.all(paths.map(path => fs.unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  })));
}
