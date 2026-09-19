import { promises as fs } from 'node:fs';
import { basename, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { activateLocalConversationStorage, type LegacyConversationScope } from '@pulse-coder/storage/local-conversations';
import { encodeSessionMessages, encodeSessionMetadata, readLegacySessionDisplayMetadata, validateLegacySession } from './sqlite-session-codec';
import type { CanvasAgentSession } from './types';
import { resolveStorageNativeBinding } from '../canvas/persistence/backend';
import { sessionStorageRoot } from './sqlite-session-backend';

interface Candidate { session: CanvasAgentSession; sortKey: number; current: boolean; archiveKeys: string[] }

async function optionalJson(path: string): Promise<unknown | undefined> {
  let contents: string;
  try { contents = await fs.readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  try { return JSON.parse(contents); }
  catch { throw new Error(`Cannot migrate corrupted session JSON: ${path}`); }
}


/** Read every legacy store, including hidden channel scopes; never start an Agent or repair source files. */
export async function readLegacySessionScopes(root: string): Promise<LegacyConversationScope[]> {
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
    const metadata = readLegacySessionDisplayMetadata(await optionalJson(metadataPath), metadataPath);
    const candidates = new Map<string, Candidate>();
    const currentPath = join(sessionsDir, 'current.json');
    const currentValue = await optionalJson(currentPath);
    const current = currentValue === undefined ? null : validateLegacySession(currentValue, currentPath);
    if (current) candidates.set(current.sessionId, { session: current, sortKey: (await fs.stat(currentPath)).mtimeMs, current: true, archiveKeys: [] });
    const archiveDir = join(sessionsDir, 'archive');
    const archives = await fs.readdir(archiveDir).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [] as string[];
      throw error;
    });
    for (const filename of archives.sort()) {
      if (!filename.endsWith('.json')) continue;
      const path = join(archiveDir, filename);
      const value = await optionalJson(path);
      if (value === undefined) throw new Error(`Session archive disappeared during migration: ${path}`);
      const session = validateLegacySession(value, path);
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

/** Bootstrap calls this before constructing any Agent or SessionStore runtime. */
export async function activateSqliteSessions(root = sessionStorageRoot()): Promise<void> {
  const storage = await activateLocalConversationStorage({
    root,
    nativeBinding: await resolveStorageNativeBinding(),
    loadLegacyScopes: () => readLegacySessionScopes(root),
  });
  await storage.close();
}
