import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import type {
  AgentScope,
  CanvasAgentMessage,
  CanvasAgentSession,
} from './types';
import { sessionPreview } from './session-preview';
import {
  listedSessionMetadata,
  patchSessionMetadata,
  readSessionMetadata,
  removeSessionMetadata,
} from './session-metadata';
import { archiveSortKey, isListableSession, scanAllWorkspaceSessions, sessionUpdatedAt, type AgentSessionListEntry } from './session-store-scan';
import { appendSessionMessages, readCurrentSessionFileAt, readSessionFile, replaceSessionMessages, type SessionFileIo, writeFileAtomic } from './session-file-io';
import { removeArchivePaths, resolveArchivedSession } from './session-archive';
import { listIndexedSessions, removeIndexedSessionFiles, updateIndexedSessionAbsoluteFile, updateIndexedSessionFile } from './session-index';
export type { AgentSessionListEntry } from './session-store-scan';
import { SqliteSessionStore } from './sqlite-session-store';
import { getSqliteSessionStorage, sessionStorageRoot, withLegacySessionWrite } from './sqlite-session-backend';
import { readCurrentSessionId, readSessionFromWorkspace, readAllSessionsWithMeta, type SessionWithMeta } from './session-store-lookups';
export { GLOBAL_CHAT_SESSION_STORE_ID, GLOBAL_CHAT_WORKSPACE_NAME } from './session-store-lookups';
export type { SessionWithMeta };
const storeDir = sessionStorageRoot;

export class SessionStore {
  private readonly root = storeDir();
  private sqlite: SqliteSessionStore | null = null;
  private sqliteOpening?: Promise<SqliteSessionStore | null>;
  private workspaceId: string;
  private sessionsDir: string;
  private currentPath: string;
  private archiveDir: string;
  private metadataPath: string;
  private scope: AgentScope;

  private session: CanvasAgentSession | null = null;
  // Serializes current.json writes; fire-and-forget mutations still retain
  // their latest failure for the next pointer-changing operation.
  private persistQueue: Promise<void> = Promise.resolve();
  private persistenceError: unknown;

  constructor(workspaceId: string, scope: AgentScope = { kind: 'workspace', workspaceId }) {
    this.workspaceId = workspaceId;
    this.scope = scope;
    this.sessionsDir = join(this.root, workspaceId, 'agent-sessions');
    this.currentPath = join(this.sessionsDir, 'current.json');
    this.archiveDir = join(this.sessionsDir, 'archive');
    this.metadataPath = join(this.sessionsDir, 'metadata.json');
  }

  private async sql(): Promise<SqliteSessionStore | null> {
    if (this.sqlite) return this.sqlite;
    if (this.sqliteOpening) return this.sqliteOpening;
    const opening = (async () => {
      const storage = await getSqliteSessionStorage(this.root);
      if (!storage) return null;
      await this.persistQueue;
      if (this.persistenceError) {
        const error = this.persistenceError;
        this.persistenceError = undefined;
        throw error;
      }
      const backend = new SqliteSessionStore(storage, this.workspaceId, this.scope);
      await backend.restoreCurrentSession();
      this.sqlite = backend;
      return backend;
    })();
    this.sqliteOpening = opening;
    try { return await opening; }
    finally { if (this.sqliteOpening === opening) this.sqliteOpening = undefined; }
  }

  /** Start a new session, archiving a useful current session first. */
  async startSession(): Promise<void> {
    const sql = await this.sql();
    if (sql) return sql.startSession();
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.mkdir(this.archiveDir, { recursive: true });
    if (this.session?.messages.length === 0 && (await this.restoreCurrentSession())?.messages.length === 0) return;

    // Archive any existing current session
    await this.archiveCurrentIfExists();

    const nextSession = this.createSession();

    await this.persist(nextSession);
    this.session = nextSession;
  }

  /** Restore current.json without archiving it. */
  async restoreCurrentSession(): Promise<CanvasAgentSession | null> {
    const sql = await this.sql();
    if (sql) return sql.restoreCurrentSession();
    await this.flushPersistence();
    const current = await this.readCurrentSessionFile();
    if (!current) return null;
    this.session = current.session;
    return current.session;
  }

  /** Prefer useful current history, otherwise hydrate the newest archive without moving the durable pointer. */
  async restoreLastSession(): Promise<CanvasAgentSession | null> {
    const sql = await this.sql();
    if (sql) return sql.restoreLastSession();
    const current = await this.restoreCurrentSession();
    if (current && current.messages.length > 0) return current;
    const [latestArchived] = await this.listArchivedSessions();
    if (!latestArchived) return current;
    const session = (await resolveArchivedSession(
      this.sessionsDir, this.metadataPath, latestArchived.sessionId,
    )).session;
    if (session) this.session = session;
    return session ?? current;
  }

  /** Add a message and enqueue persistence. */
  addMessage(message: CanvasAgentMessage): void {
    if (this.sqlite) return this.sqlite.addMessage(message);
    if (!this.session) return;
    this.session.messages.push(message);
    // Fire-and-forget persist
    void this.persist();
  }

  /** Replace all messages and enqueue one full-session write. */
  setMessages(messages: CanvasAgentMessage[]): void {
    if (this.sqlite) return this.sqlite.setMessages(messages);
    if (!this.session) return;
    this.session.messages = messages;
    void this.persist();
  }

  /** Return the live current message list. */
  getMessages(): CanvasAgentMessage[] {
    return this.sqlite ? this.sqlite.getMessages() : this.session?.messages ?? [];
  }

  /** Structural I/O surface for session-anchored reads/appends (see session-file-io). */
  private sessionFileIo(): SessionFileIo {
    return {
      root: this.root,
      currentPath: this.currentPath,
      archiveDir: this.archiveDir,
      session: this.session,
      flushPersistence: () => this.flushPersistence(),
      persist: (session) => this.persist(session),
      readCurrentSessionFile: () => this.readCurrentSessionFile(),
      onSessionFileWritten: (path, session) => updateIndexedSessionAbsoluteFile(
        this.sessionsDir, this.metadataPath, path, session,
      ).catch(error => console.warn('[session-store] Could not update session index:', error)),
      workspaceId: this.workspaceId,
      scope: this.scope,
    };
  }

  /** Read a session (current or newest archive) without moving the pointer. */
  async readSession(sessionId: string): Promise<CanvasAgentSession | null> {
    const sql = await this.sql();
    if (sql) return sql.readSession(sessionId);
    return readSessionFile(this.sessionFileIo(), sessionId);
  }

  /** Append to a session without moving the pointer (session-anchored runs). */
  async appendToSession(
    sessionId: string,
    messages: CanvasAgentMessage[],
  ): Promise<void> {
    const sql = await this.sql();
    if (sql) return sql.appendToSession(sessionId, messages);
    return appendSessionMessages(this.sessionFileIo(), sessionId, messages);
  }

  async replaceMessagesInSession(sessionId: string, messages: CanvasAgentMessage[]): Promise<void> {
    const sql = await this.sql();
    if (sql) return sql.replaceMessagesInSession(sessionId, messages);
    return replaceSessionMessages(this.sessionFileIo(), sessionId, messages);
  }

  /** Explicit pointer-neutral creation for channel provisioning and conversation copies. */
  async createConversationById(sessionId: string, messages: CanvasAgentMessage[]): Promise<void> {
    const sql = await this.sql();
    if (sql) return sql.createConversationById(sessionId, messages);
    if (await this.readSession(sessionId)) throw new Error(`Conversation already exists: ${sessionId}`);
    const session = { ...this.createSession(messages), sessionId };
    await this.writeArchiveFile(session, JSON.stringify(session, null, 2));
  }

  /** Drop the abandoned tail used by edit/regenerate flows. */
  truncateMessages(fromIndex: number): void {
    if (this.sqlite) return this.sqlite.truncateMessages(fromIndex);
    if (!this.session) return;
    if (fromIndex < 0) return;
    if (fromIndex >= this.session.messages.length) return;
    this.session.messages.length = fromIndex;
    void this.persist();
  }

  /** Durably archive the current session before clearing its pointer. */
  async archiveSession(): Promise<void> {
    const sql = await this.sql();
    if (sql) return sql.archiveSession();
    await this.archiveCurrentIfExists(false, true);
    this.session = null;
  }

  /** Branch from a prefix while preserving the source conversation intact. */
  async branchSession(
    fromIndex: number,
  ): Promise<{ sourceSessionId: string; session: CanvasAgentSession } | null> {
    const sql = await this.sql();
    if (sql) return sql.branchSession(fromIndex);
    if (!this.session) return null;
    const sourceSessionId = this.session.sessionId;
    const endIndex = Number.isFinite(fromIndex)
      ? Math.max(0, Math.min(Math.trunc(fromIndex), this.session.messages.length))
      : this.session.messages.length;
    const messages = this.session.messages.slice(0, endIndex);

    await this.archiveCurrentIfExists(true);
    const nextSession = this.createSession(messages);
    await this.persist(nextSession);
    this.session = nextSession;
    return { sourceSessionId, session: nextSession };
  }

  async renameSession(sessionId: string, title: string): Promise<boolean> {
    const sql = await this.sql();
    if (sql) return sql.renameSession(sessionId, title);
    const normalizedTitle = title.trim();
    if (!normalizedTitle || !await this.hasSession(sessionId)) return false;
    await patchSessionMetadata(this.metadataPath, sessionId, { title: normalizedTitle });
    return true;
  }

  async setSessionPinned(sessionId: string, pinned: boolean): Promise<boolean> {
    const sql = await this.sql();
    if (sql) return sql.setSessionPinned(sessionId, pinned);
    if (!await this.hasSession(sessionId)) return false;
    await patchSessionMetadata(this.metadataPath, sessionId, { pinned });
    return true;
  }

  async listSessions(): Promise<AgentSessionListEntry[]> {
    const sql = await this.sql();
    if (sql) return sql.listSessions();
    const archived = await this.listArchivedSessions();
    const current = this.session;
    if (!current || !isListableSession(current)) return archived.map((session) => ({ ...session, isCurrent: false }));
    const metadata = await readSessionMetadata(this.metadataPath);
    const firstUserMessage = current.messages.find((message) => message.role === 'user');
    return [{
      sessionId: current.sessionId,
      date: current.startedAt.slice(0, 10),
      updatedAt: sessionUpdatedAt(current, await archiveSortKey(this.currentPath, '')),
      messageCount: current.messages.length,
      preview: firstUserMessage ? sessionPreview(firstUserMessage.content) : '',
      ...listedSessionMetadata(metadata, current.sessionId),
      isCurrent: true,
    }, ...archived.map((session) => ({ ...session, isCurrent: false }))];
  }

  async deleteSession(sessionId: string): Promise<{
    deletedCurrent: boolean;
    activeSession: CanvasAgentSession;
  } | null> {
    const sql = await this.sql();
    if (sql) return sql.deleteSession(sessionId);
    await this.flushPersistence();
    if (!this.session) await this.restoreCurrentSession();
    if (!this.session && !await this.hasSession(sessionId)) return null;
    if (!this.session) await this.startSession();
    const deletedCurrent = this.session?.sessionId === sessionId;
    if (deletedCurrent) {
      await this.removeArchivedSessionsById(sessionId);
      const nextSession = this.createSession();
      await this.persist(nextSession);
      this.session = nextSession;
    } else if (!await this.removeArchivedSessionsById(sessionId)) return null;
    await removeSessionMetadata(this.metadataPath, sessionId)
      .catch(error => console.warn('[session-store] Could not clean deleted session metadata:', error));
    return { deletedCurrent, activeSession: this.session! };
  }

  /** List archived sessions with persisted display metadata. */
  async listArchivedSessions(): Promise<Array<Omit<AgentSessionListEntry, 'isCurrent'>>> {
    const sql = await this.sql();
    if (sql) return sql.listArchivedSessions();
    const sessions = await listIndexedSessions(this.sessionsDir, this.metadataPath);
    return sessions
      .filter(session => !session.isCurrent && session.sessionId !== this.session?.sessionId)
      .map(({ isCurrent: _isCurrent, ...session }) => session);
  }

  /** Read a legacy date-named archive. */
  async readArchivedSession(date: string): Promise<CanvasAgentSession | null> {
    const sql = await this.sql();
    if (sql) return sql.readArchivedSession(date);
    try {
      const raw = await fs.readFile(join(this.archiveDir, `${date}.json`), 'utf-8');
      return JSON.parse(raw) as CanvasAgentSession;
    } catch {
      return null;
    }
  }

  /** Return the in-memory current session. */
  getCurrentSession(): CanvasAgentSession | null {
    return this.sqlite ? this.sqlite.getCurrentSession() : this.session;
  }

  /** Promote an archived session after durably archiving current history. */
  async loadSession(sessionId: string): Promise<CanvasAgentSession | null> {
    const sql = await this.sql();
    if (sql) return sql.loadSession(sessionId);
    await this.flushPersistence();
    const resolved = await resolveArchivedSession(this.sessionsDir, this.metadataPath, sessionId);
    const cleanup = () => removeArchivePaths(resolved.matchingPaths)
      .then(() => removeIndexedSessionFiles(this.sessionsDir, this.metadataPath, resolved.matchingPaths))
      .catch(error => console.warn('[session-store] Could not clean promoted archive:', error));
    // If the requested session is already current, do not create another copy.
    if (this.session?.sessionId === sessionId) {
      await cleanup();
      return this.session;
    }

    const current = await this.readCurrentSessionFile();
    if (current?.session.sessionId === sessionId) {
      this.session = current.session;
      await cleanup();
      return current.session;
    }
    const matched = resolved.session;
    if (!matched) return null;

    // Archive current session first, then promote the archived session to
    // current and remove archived copies of the same sessionId. Without this
    // cleanup, continuing an old conversation appears as a duplicate/new row.
    await this.archiveCurrentIfExists();
    await this.persist(matched);
    this.session = matched;
    await cleanup();
    return matched;
  }

  // ─── Cross-workspace scanning ────────────────────────────────

  /** Scan all listable session stores. */
  static listAllWorkspaceSessions(excludedStoreIds?: ReadonlySet<string>, visibleWorkspaceIds?: ReadonlySet<string>) {
    return scanAllWorkspaceSessions(storeDir(), excludedStoreIds, visibleWorkspaceIds);
  }

  /** Cold lookups select the same backend without activating an Agent. */
  static readCurrentSessionId(storeId: string): Promise<string | null> {
    return readCurrentSessionId(storeDir(), storeId);
  }

  static readSessionFromWorkspace(storeId: string, sessionId: string): Promise<CanvasAgentSession | null> {
    return readSessionFromWorkspace(storeDir(), storeId, sessionId);
  }

  static readAllSessionsWithMeta(): Promise<SessionWithMeta[]> {
    return readAllSessionsWithMeta(storeDir());
  }

  // ─── Internal ────────────────────────────────────────────────

  private createSession(messages: CanvasAgentMessage[] = []): CanvasAgentSession {
    return {
      sessionId: `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      workspaceId: this.workspaceId,
      scope: this.scope,
      startedAt: new Date().toISOString(),
      messages,
    };
  }

  private async hasSession(sessionId: string): Promise<boolean> {
    await this.flushPersistence();
    if (this.session?.sessionId === sessionId) return true;
    return Boolean(await SessionStore.readSessionFromWorkspace(this.workspaceId, sessionId));
  }

  private async removeArchivedSessionsById(sessionId: string): Promise<boolean> {
    let removed = false;
    const removedPaths: string[] = [];
    const files = await fs.readdir(this.archiveDir).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    await Promise.all(files.map(async (file) => {
      if (!file.endsWith('.json')) return;
      const archivePath = join(this.archiveDir, file);
      let data: CanvasAgentSession;
      try {
        data = JSON.parse(await fs.readFile(archivePath, 'utf-8')) as CanvasAgentSession;
      } catch {
        return; // skip missing or corrupted files
      }
      if (data.sessionId !== sessionId) return;
      try {
        await withLegacySessionWrite(this.root, () => fs.unlink(archivePath));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      removed = true;
      removedPaths.push(archivePath);
    }));
    await removeIndexedSessionFiles(this.sessionsDir, this.metadataPath, removedPaths)
      .catch(error => console.warn('[session-store] Could not clean archived session index:', error));
    return removed;
  }

  // Chain snapshots so renames never overlap; the last queued write wins.
  private persist(session: CanvasAgentSession | null = this.session): Promise<void> {
    if (!session) return Promise.resolve();
    const serialized = JSON.stringify(session, null, 2);
    const run = this.persistQueue.then(async () => {
      try {
        await this.writeSessionFile(serialized);
        await updateIndexedSessionFile(this.sessionsDir, this.metadataPath, 'current.json', session)
          .catch(error => console.warn('[session-store] Could not update current session index:', error));
      } catch (error) {
        // Retain the first failure until a synchronization boundary observes
        // it; a later successful snapshot must not erase a lost write.
        this.persistenceError ??= error;
        throw error;
      }
    });
    // Keep the chain alive even if one write rejects, so later persists run.
    this.persistQueue = run.catch(() => {});
    // Fire-and-forget callers intentionally do not await persist(). Attach a
    // rejection handler without changing the promise returned to callers that
    // do need the failure.
    void run.catch(() => undefined);
    return run;
  }

  private async flushPersistence(): Promise<void> {
    await this.persistQueue;
    const failure = this.persistenceError;
    if (!failure) return;
    this.persistenceError = undefined;
    // The caller must still observe the failed queued write, but repair the
    // durable pointer from the unchanged in-memory session first. This keeps
    // the operation fail-closed while allowing an explicit second attempt
    // after a transient filesystem error.
    if (this.session) {
      await this.persist(this.session).catch(() => undefined);
    }
    throw failure;
  }

  private async writeSessionFile(serialized: string): Promise<void> {
    await writeFileAtomic(this.currentPath, serialized, this.root);
  }

  private async readCurrentSessionFile(): Promise<{
    raw: string;
    session: CanvasAgentSession;
  } | null> {
    return readCurrentSessionFileAt(this.currentPath);
  }

  private async writeArchiveFile(session: CanvasAgentSession, raw: string): Promise<void> {
    await fs.mkdir(this.archiveDir, { recursive: true });
    const date = session.startedAt.slice(0, 10);
    const sessionId = session.sessionId
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120) || 'session';
    const archiveFile = `${date}-${sessionId}-${randomUUID()}.json`;
    const archivePath = join(this.archiveDir, archiveFile);
    const tmp = `${archivePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      await withLegacySessionWrite(this.root, async () => {
        handle = await fs.open(tmp, 'wx');
        await handle.writeFile(raw, 'utf-8');
        await handle.sync();
        await handle.close();
        handle = undefined;
        await fs.rename(tmp, archivePath);
      });
      await updateIndexedSessionFile(this.sessionsDir, this.metadataPath, `archive/${archiveFile}`, session)
        .catch(error => console.warn('[session-store] Could not update archived session index:', error));
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await fs.unlink(tmp).catch(() => undefined);
      throw error;
    }
  }

  private async archiveCurrentIfExists(
    preserveEmpty = false,
    removeCurrent = false,
  ): Promise<CanvasAgentSession | null> {
    // Settle queued writes before moving the durable pointer.
    await this.flushPersistence();
    const current = await this.readCurrentSessionFile();
    if (!current) return null;

    if (preserveEmpty || current.session.messages.length > 0) {
      await this.writeArchiveFile(current.session, current.raw);
    }
    if (removeCurrent) {
      try {
        await withLegacySessionWrite(this.root, () => fs.unlink(this.currentPath));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      await removeIndexedSessionFiles(this.sessionsDir, this.metadataPath, [this.currentPath])
        .catch(error => console.warn('[session-store] Could not clean current session index:', error));
    }
    return current.session;
  }
}
