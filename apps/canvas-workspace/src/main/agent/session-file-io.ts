import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type { AgentScope, CanvasAgentMessage, CanvasAgentSession } from './types';
import { archiveSortKey } from './session-store-scan';

/**
 * Session-addressed file I/O for session-anchored runs: read and append to a
 * conversation (current or newest archived copy) without moving the current
 * pointer. Kept out of session-store.ts (file-size governance) while reusing
 * the store's invariants: every read flushes the persistence queue first and
 * every write goes through the atomic temp+rename writer.
 */

/** Structural surface of SessionStore that these helpers need. */
export interface SessionFileIo {
  currentPath: string;
  archiveDir: string;
  session: CanvasAgentSession | null;
  flushPersistence(): Promise<void>;
  persist(session?: CanvasAgentSession | null): Promise<void>;
  readCurrentSessionFile(): Promise<{ raw: string; session: CanvasAgentSession } | null>;
  onSessionFileWritten(path: string, session: CanvasAgentSession): Promise<void>;
  workspaceId: string;
  scope: AgentScope;
}

/**
 * Locate a session's durable file (current.json or the newest archive copy)
 * without moving the current pointer.
 */
export async function findSessionFile(
  store: SessionFileIo,
  sessionId: string,
): Promise<{ path: string; session: CanvasAgentSession } | null> {
  await store.flushPersistence();
  const current = await store.readCurrentSessionFile().catch(() => null);
  if (current?.session.sessionId === sessionId) {
    return { path: store.currentPath, session: current.session };
  }

  let matched: { path: string; session: CanvasAgentSession } | null = null;
  let matchedSortKey = -1;
  let files: string[] = [];
  try {
    files = await fs.readdir(store.archiveDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const archivePath = join(store.archiveDir, file);
    try {
      const raw = await fs.readFile(archivePath, 'utf-8');
      const data = JSON.parse(raw) as CanvasAgentSession;
      if (data.sessionId !== sessionId) continue;
      const sortKey = await archiveSortKey(archivePath, file);
      if (!matched || sortKey > matchedSortKey) {
        matched = { path: archivePath, session: data };
        matchedSortKey = sortKey;
      }
    } catch {
      // skip missing or corrupted archive files
    }
  }
  return matched;
}

/** Read a session (current or newest archived copy) without moving the pointer. */
export async function readSessionFile(
  store: SessionFileIo,
  sessionId: string,
): Promise<CanvasAgentSession | null> {
  const found = await findSessionFile(store, sessionId);
  return found?.session ?? null;
}

/**
 * Append messages to an arbitrary session without moving the current pointer.
 * Fast path: the session IS current — mirror the store's addMessage. Slow
 * path: rewrite the newest archived copy of that session in place. Callers
 * MUST serialize this against pointer mutations (the coordinator's per-scope
 * tails) — both read the same files, and an unsynchronized write can
 * resurrect an old current.json after a load swapped it.
 */
export async function appendSessionMessages(
  store: SessionFileIo,
  sessionId: string,
  messages: CanvasAgentMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  await store.flushPersistence();
  if (store.session?.sessionId === sessionId) {
    store.session.messages.push(...messages);
    await store.persist();
    return;
  }
  const found = await findSessionFile(store, sessionId);
  if (!found) {
    // The run anchored to a conversation that is not yet durable (e.g. an
    // empty current draft the UI created but never persisted). Do not drop
    // the turn silently: materialize the anchored session (preserving its id).
    const created: CanvasAgentSession = {
      sessionId,
      workspaceId: store.workspaceId,
      scope: store.scope,
      startedAt: new Date().toISOString(),
      messages: [...messages],
    };
    await store.persist(created);
    return;
  }
  const updated: CanvasAgentSession = {
    ...found.session,
    messages: [...found.session.messages, ...messages],
  };
  await writeFileAtomic(found.path, JSON.stringify(updated, null, 2));
  await store.onSessionFileWritten(found.path, updated);
}

/**
 * Replace a session's message list in place without moving the current
 * pointer. Session-anchored full-state writes (conversation runtime persist)
 * need this so a run never depends on which session is "current".
 */
export async function replaceSessionMessages(
  store: SessionFileIo,
  sessionId: string,
  messages: CanvasAgentMessage[],
): Promise<void> {
  await store.flushPersistence();
  if (store.session?.sessionId === sessionId) {
    store.session.messages = [...messages];
    await store.persist();
    return;
  }
  const found = await findSessionFile(store, sessionId);
  if (!found) {
    const created: CanvasAgentSession = {
      sessionId,
      workspaceId: store.workspaceId,
      scope: store.scope,
      startedAt: new Date().toISOString(),
      messages: [...messages],
    };
    await store.persist(created);
    return;
  }
  const updated: CanvasAgentSession = {
    ...found.session,
    messages: [...messages],
  };
  await writeFileAtomic(found.path, JSON.stringify(updated, null, 2));
  await store.onSessionFileWritten(found.path, updated);
}

/** Read and parse current.json; null when absent, throws when corrupted. */
export async function readCurrentSessionFileAt(
  currentPath: string,
): Promise<{ raw: string; session: CanvasAgentSession } | null> {
  let raw: string;
  try {
    raw = await fs.readFile(currentPath, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  let session: CanvasAgentSession;
  try {
    session = JSON.parse(raw) as CanvasAgentSession;
  } catch (error) {
    throw new Error(
      `Current session is corrupted at ${currentPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!session.sessionId || !Array.isArray(session.messages)) {
    throw new Error(`Current session is corrupted at ${currentPath}: invalid session shape`);
  }
  return { raw, session };
}

/** Atomic temp+rename write (shared by the current pointer and session appends). */
export async function writeFileAtomic(
  targetPath: string,
  serialized: string,
): Promise<void> {
  // Unique per-write temp name (pid + random) so two writers for the same
  // file never collide on one temp file.
  const tmp = `${targetPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, serialized, 'utf-8');
    await fs.rename(tmp, targetPath);
    if (process.env.PULSE_CANVAS_PERF) {
      console.log(`[perf] session-persist ${JSON.stringify({ bytes: Buffer.byteLength(serialized, 'utf-8') })}`);
    }
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    console.error('[session-store] Failed to persist session:', err);
    throw err;
  }
}
