import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { writeJsonAtomic } from '@pulse-coder/storage/local';
import { activateLocalConversationStorage, type LegacyConversationScope } from '@pulse-coder/storage/local-conversations';
import {
  encodeSessionMessages, encodeSessionMetadata, readLegacySessionDisplayMetadata, UnreadableSessionFileError, validateLegacySession,
} from './sqlite-session-codec';
import type { CanvasAgentSession } from './types';
import { resolveStorageNativeBinding } from '../canvas/persistence/backend';
import { sessionStorageRoot } from './sqlite-session-backend';

interface Candidate { session: CanvasAgentSession; sortKey: number; current: boolean; archiveKeys: string[] }

/** A legacy file left in place, unimported, because its content could not be read. */
export interface SkippedSessionFile { path: string; reason: string }

async function optionalJson(path: string): Promise<unknown | undefined> {
  let contents: string;
  try { contents = await fs.readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try { return JSON.parse(contents); }
  catch { throw new UnreadableSessionFileError(path, `Cannot migrate corrupted session JSON: ${path}`); }
}

/** Only unreadable content is skipped; I/O failures, conflicts and future schemas still stop migration. */
async function readOrSkip<T>(skipped: SkippedSessionFile[], read: () => Promise<T>): Promise<T | undefined> {
  try {
    return await read();
  } catch (error) {
    if (!(error instanceof UnreadableSessionFileError)) throw error;
    skipped.push({ path: error.path, reason: error.message });
    return undefined;
  }
}


/** Read every legacy store, including hidden channel scopes; never start an Agent or repair source files. */
export async function readLegacySessionScopes(root: string, skipped: SkippedSessionFile[] = []): Promise<LegacyConversationScope[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  const scopes: LegacyConversationScope[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const sessionsDir = join(root, entry.name, 'agent-sessions');
    const exists = await fs.stat(sessionsDir).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (!exists) continue;
    if (!exists.isDirectory()) throw new Error(`Session store is not a directory: ${sessionsDir}`);
    const metadataPath = join(sessionsDir, 'metadata.json');
    const metadata = await readOrSkip(skipped, async () => (
      readLegacySessionDisplayMetadata(await optionalJson(metadataPath), metadataPath)
    )) ?? {};
    const candidates = new Map<string, Candidate>();
    const currentPath = join(sessionsDir, 'current.json');
    const current = await readOrSkip(skipped, async () => {
      const value = await optionalJson(currentPath);
      return value === undefined ? null : validateLegacySession(value, currentPath);
    }) ?? null;
    if (current) candidates.set(current.sessionId, { session: current, sortKey: (await fs.stat(currentPath)).mtimeMs, current: true, archiveKeys: [] });
    const archiveDir = join(sessionsDir, 'archive');
    const archives = await fs.readdir(archiveDir).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[];
      throw error;
    });
    for (const filename of archives.sort()) {
      if (!filename.endsWith('.json')) continue;
      const path = join(archiveDir, filename);
      const session = await readOrSkip(skipped, async () => {
        const value = await optionalJson(path);
        if (value === undefined) throw new Error(`Session archive disappeared during migration: ${path}`);
        return validateLegacySession(value, path);
      });
      if (!session) continue;
      const sortKey = (await fs.stat(path)).mtimeMs;
      const previous = candidates.get(session.sessionId);
      const archiveKeys = [...(previous?.archiveKeys ?? []), basename(filename, '.json')];
      if (previous && !previous.current && sortKey === previous.sortKey && !isDeepStrictEqual(previous.session, session)) {
        throw new Error(`Conflicting archive copies have no reliable newest version for ${session.sessionId} in ${sessionsDir}`);
      }
      if (!previous || (!previous.current && sortKey > previous.sortKey)) {
        candidates.set(session.sessionId, { session, sortKey, current: false, archiveKeys });
      } else previous.archiveKeys = archiveKeys;
    }
    scopes.push({
      scopeId: entry.name,
      currentSessionId: current?.sessionId ?? null,
      conversations: [...candidates.values()].sort((left, right) => left.session.sessionId.localeCompare(right.session.sessionId)).map(candidate => ({
        sessionId: candidate.session.sessionId,
        metadata: encodeSessionMetadata(candidate.session, {}, {
          ...metadata[candidate.session.sessionId], archiveKeys: candidate.archiveKeys,
        }, candidate.sortKey),
        messages: encodeSessionMessages(entry.name, candidate.session.sessionId, candidate.session.messages, { migration: true }),
      })),
    });
  }
  return scopes;
}

/**
 * Bootstrap calls this before constructing any Agent or SessionStore runtime.
 * Returns the unreadable files this cutover left behind; their sources are untouched.
 */
export async function activateSqliteSessions(root = sessionStorageRoot()): Promise<SkippedSessionFile[]> {
  let skipped: SkippedSessionFile[] = [];
  const storage = await activateLocalConversationStorage({
    root,
    nativeBinding: await resolveStorageNativeBinding(),
    loadLegacyScopes: async () => {
      // The importer reads twice to detect concurrent edits; keep the final read's list.
      const found: SkippedSessionFile[] = [];
      const scopes = await readLegacySessionScopes(root, found);
      skipped = found;
      return scopes;
    },
  });
  await storage.close();
  if (skipped.length) {
    // Recorded next to the migration backups; SQL is authoritative from here on.
    const backupDirectory = join(root, '__storage-backup__');
    await fs.mkdir(backupDirectory, { recursive: true });
    await writeJsonAtomic(join(backupDirectory, `conversations-skipped-${randomUUID()}.json`), {
      schemaVersion: 1, createdAt: new Date().toISOString(), files: skipped,
    });
  }
  return skipped;
}
