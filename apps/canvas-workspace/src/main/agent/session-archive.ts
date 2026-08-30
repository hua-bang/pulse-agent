import { promises as fs } from 'fs';
import { join } from 'path';
import type { CanvasAgentSession } from './types';
import { archiveSortKey } from './session-store-scan';

export interface ResolvedArchivedSession {
  session: CanvasAgentSession | null;
  matchingPaths: string[];
}

/** Locate the newest copy and every duplicate path in one archive pass. */
export async function resolveArchivedSession(
  archiveDir: string,
  sessionId: string,
): Promise<ResolvedArchivedSession> {
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
