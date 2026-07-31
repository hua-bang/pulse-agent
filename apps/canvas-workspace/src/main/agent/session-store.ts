import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import type {
  AgentScope,
  CanvasAgentDebugRunDetail,
  CanvasAgentDebugRunSummary,
  CanvasAgentMessage,
  CanvasAgentSession,
} from './types';
import { sessionPreview } from './session-preview';
import { isListableSessionStore } from '../../shared/agent-chat';
import {
  listedSessionMetadata,
  patchSessionMetadata,
  readSessionMetadata,
  removeSessionMetadata,
} from './session-metadata';
import {
  archiveSortKey,
  scanAllWorkspaceSessions,
  type AgentSessionListEntry,
} from './session-store-scan';
export type { AgentSessionListEntry } from './session-store-scan';
// Lazy so tests can redirect storage through the environment.
const storeDir = (): string =>
  process.env.PULSE_CANVAS_SESSION_STORE_DIR || join(homedir(), '.pulse-coder', 'canvas');
export const GLOBAL_CHAT_SESSION_STORE_ID = '__global_chat__';
export const GLOBAL_CHAT_WORKSPACE_NAME = 'Global Chat';

interface WorkspaceManifest {
  workspaces: Array<{ id: string; name: string }>;
  activeId?: string;
}

export interface SessionWithMeta {
  session: CanvasAgentSession;
  workspaceName: string;
  isCurrent: boolean;
  sortKey: number;
}

export class SessionStore {
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
    this.sessionsDir = join(storeDir(), workspaceId, 'agent-sessions');
    this.currentPath = join(this.sessionsDir, 'current.json');
    this.archiveDir = join(this.sessionsDir, 'archive');
    this.metadataPath = join(this.sessionsDir, 'metadata.json');
  }

  /** Start a new session, archiving a useful current session first. */
  async startSession(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.mkdir(this.archiveDir, { recursive: true });

    // Archive any existing current session
    await this.archiveCurrentIfExists();

    const nextSession = this.createSession();

    await this.persist(nextSession);
    this.session = nextSession;
  }

  /** Restore current.json without archiving it. */
  async restoreCurrentSession(): Promise<CanvasAgentSession | null> {
    await this.flushPersistence();
    const current = await this.readCurrentSessionFile();
    if (!current) return null;
    this.session = current.session;
    return current.session;
  }

  /** Prefer useful current history, otherwise promote the newest archive. */
  async restoreLastSession(): Promise<CanvasAgentSession | null> {
    const current = await this.restoreCurrentSession();
    if (current && current.messages.length > 0) return current;

    const [latestArchived] = await this.listArchivedSessions();
    if (!latestArchived) return current;

    return this.loadSession(latestArchived.sessionId);
  }

  /** Add a message and enqueue persistence. */
  addMessage(message: CanvasAgentMessage): void {
    if (!this.session) return;
    this.session.messages.push(message);
    // Fire-and-forget persist
    void this.persist();
  }

  /** Replace all messages and enqueue one full-session write. */
  setMessages(messages: CanvasAgentMessage[]): void {
    if (!this.session) return;
    this.session.messages = messages;
    void this.persist();
  }

  /** Return the live current message list. */
  getMessages(): CanvasAgentMessage[] {
    return this.session?.messages ?? [];
  }

  /** Drop the abandoned tail used by edit/regenerate flows. */
  truncateMessages(fromIndex: number): void {
    if (!this.session) return;
    if (fromIndex < 0) return;
    if (fromIndex >= this.session.messages.length) return;
    this.session.messages.length = fromIndex;
    void this.persist();
  }

  /** Durably archive the current session before clearing its pointer. */
  async archiveSession(): Promise<void> {
    await this.archiveCurrentIfExists(false, true);
    this.session = null;
  }

  /** Branch from a prefix while preserving the source conversation intact. */
  async branchSession(
    fromIndex: number,
  ): Promise<{ sourceSessionId: string; session: CanvasAgentSession } | null> {
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
    const normalizedTitle = title.trim();
    if (!normalizedTitle || !await this.hasSession(sessionId)) return false;
    await patchSessionMetadata(this.metadataPath, sessionId, { title: normalizedTitle });
    return true;
  }

  async setSessionPinned(sessionId: string, pinned: boolean): Promise<boolean> {
    if (!await this.hasSession(sessionId)) return false;
    await patchSessionMetadata(this.metadataPath, sessionId, { pinned });
    return true;
  }

  async listSessions(): Promise<AgentSessionListEntry[]> {
    const archived = await this.listArchivedSessions();
    const current = this.session;
    if (!current) return archived.map((session) => ({ ...session, isCurrent: false }));
    const metadata = await readSessionMetadata(this.metadataPath);
    const firstUserMessage = current.messages.find((message) => message.role === 'user');
    return [{
      sessionId: current.sessionId,
      date: current.startedAt.slice(0, 10),
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
    try {
      const files = await fs.readdir(this.archiveDir);
      const metadata = await readSessionMetadata(this.metadataPath);
      const currentSessionId = this.session?.sessionId;
      const sessionsById = new Map<string, {
        sessionId: string;
        date: string;
        messageCount: number;
        preview: string;
        title?: string;
        pinned: boolean;
        sortKey: number;
      }>();

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const archivePath = join(this.archiveDir, file);
          const raw = await fs.readFile(archivePath, 'utf-8');
          const data = JSON.parse(raw) as CanvasAgentSession;

          // A session restored from archive becomes current. Hide any stale
          // archived copy so the session list does not show the same thread
          // twice while the user continues chatting in it.
          if (currentSessionId && data.sessionId === currentSessionId) continue;

          const firstUserMsg = data.messages.find(m => m.role === 'user');
          const sortKey = await archiveSortKey(archivePath, file);
          const session = {
            sessionId: data.sessionId,
            date: data.startedAt?.slice(0, 10) || file.replace('.json', '').slice(0, 10),
            messageCount: data.messages.length,
            preview: firstUserMsg ? sessionPreview(firstUserMsg.content) : '',
            ...listedSessionMetadata(metadata, data.sessionId),
            sortKey,
          };
          const existing = sessionsById.get(data.sessionId);
          if (!existing || sortKey > existing.sortKey) {
            sessionsById.set(data.sessionId, session);
          }
        } catch {
          // skip corrupted files
        }
      }

      return Array.from(sessionsById.values())
        .sort((a, b) => b.sortKey - a.sortKey || b.date.localeCompare(a.date))
        .map(({ sortKey: _sortKey, ...session }) => session);
    } catch {
      return [];
    }
  }

  /** Read a legacy date-named archive. */
  async readArchivedSession(date: string): Promise<CanvasAgentSession | null> {
    try {
      const raw = await fs.readFile(join(this.archiveDir, `${date}.json`), 'utf-8');
      return JSON.parse(raw) as CanvasAgentSession;
    } catch {
      return null;
    }
  }

  /** Return the in-memory current session. */
  getCurrentSession(): CanvasAgentSession | null {
    return this.session;
  }

  /** Promote an archived session after durably archiving current history. */
  async loadSession(sessionId: string): Promise<CanvasAgentSession | null> {
    await this.flushPersistence();
    const cleanup = () => this.removeArchivedSessionsById(sessionId).catch(error => console.warn('[session-store] Could not clean promoted archive:', error));
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
    let matched: CanvasAgentSession | null = null;
    let matchedSortKey = -1;

    // Find the newest archived copy by sessionId. Older versions may exist
    // from the previous restore behavior, so choose the latest and clean up
    // all archived copies after it is promoted to current.
    try {
      const files = await fs.readdir(this.archiveDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const archivePath = join(this.archiveDir, file);
        const raw = await fs.readFile(archivePath, 'utf-8');
        const data = JSON.parse(raw) as CanvasAgentSession;
        if (data.sessionId !== sessionId) continue;

        const sortKey = await archiveSortKey(archivePath, file);
        if (!matched || sortKey > matchedSortKey) {
          matched = data;
          matchedSortKey = sortKey;
        }
      }
    } catch {
      // ignore
    }

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
  static listAllWorkspaceSessions() {
    return scanAllWorkspaceSessions(storeDir());
  }

  /** Read a store's on-disk current id without activating an agent. */
  static async readCurrentSessionId(storeId: string): Promise<string | null> {
    try {
      const raw = await fs.readFile(join(storeDir(), storeId, 'agent-sessions', 'current.json'), 'utf-8');
      const data = JSON.parse(raw) as CanvasAgentSession;
      return data.sessionId ?? null;
    } catch {
      return null;
    }
  }

  /** Read a current or archived session from another workspace. */
  static async readSessionFromWorkspace(
    sourceWorkspaceId: string,
    sessionId: string,
  ): Promise<CanvasAgentSession | null> {
    const sessionsDir = join(storeDir(), sourceWorkspaceId, 'agent-sessions');
    const currentPath = join(sessionsDir, 'current.json');
    const archiveDir = join(sessionsDir, 'archive');

    // Check current session first
    try {
      const raw = await fs.readFile(currentPath, 'utf-8');
      const data = JSON.parse(raw) as CanvasAgentSession;
      if (data.sessionId === sessionId) return data;
    } catch {
      // ignore
    }

    // Check archive. If duplicate archived copies exist, return the newest one.
    let matched: CanvasAgentSession | null = null;
    let matchedSortKey = -1;
    try {
      const files = await fs.readdir(archiveDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const archivePath = join(archiveDir, file);
        const raw = await fs.readFile(archivePath, 'utf-8');
        const data = JSON.parse(raw) as CanvasAgentSession;
        if (data.sessionId !== sessionId) continue;

        const sortKey = await archiveSortKey(archivePath, file);
        if (!matched || sortKey > matchedSortKey) {
          matched = data;
          matchedSortKey = sortKey;
        }
      }
    } catch {
      // ignore
    }

    return matched;
  }

  /** Read all sessions for the cross-workspace history tools. */
  static async readAllSessionsWithMeta(): Promise<SessionWithMeta[]> {
    const manifest = await loadManifest();
    const workspaceNames = new Map(manifest.workspaces.map(workspace => [workspace.id, workspace.name] as const));
    const results: SessionWithMeta[] = [];

    let dirs: string[];
    try {
      dirs = await fs.readdir(storeDir());
    } catch {
      return results;
    }

    for (const workspaceId of dirs) {
      if (!isListableSessionStore(workspaceId)) continue;
      const workspaceName = workspaceId === GLOBAL_CHAT_SESSION_STORE_ID
        ? GLOBAL_CHAT_WORKSPACE_NAME
        : workspaceNames.get(workspaceId) ?? workspaceId;
      const sessionsDir = join(storeDir(), workspaceId, 'agent-sessions');
      const currentPath = join(sessionsDir, 'current.json');
      const archiveDir = join(sessionsDir, 'archive');
      const seen = new Set<string>();

      try {
        const raw = await fs.readFile(currentPath, 'utf-8');
        const session = JSON.parse(raw) as CanvasAgentSession;
        seen.add(session.sessionId);
        results.push({ session, workspaceName, isCurrent: true, sortKey: Date.now() });
      } catch {
        // No current session
      }

      try {
        const files = await fs.readdir(archiveDir);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const archivePath = join(archiveDir, file);
          try {
            const raw = await fs.readFile(archivePath, 'utf-8');
            const session = JSON.parse(raw) as CanvasAgentSession;
            if (seen.has(session.sessionId)) continue;
            seen.add(session.sessionId);
            results.push({
              session,
              workspaceName,
              isCurrent: false,
              sortKey: await archiveSortKey(archivePath, file),
            });
          } catch {
            // skip corrupted archive
          }
        }
      } catch {
        // No archive dir
      }
    }

    results.sort((a, b) => b.sortKey - a.sortKey);
    return results;
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
        await fs.unlink(archivePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      removed = true;
    }));
    return removed;
  }

  // Chain captured snapshots so temp-file renames never overlap; the last
  // queued snapshot wins and a failed write cannot poison the queue tail.
  private persist(session: CanvasAgentSession | null = this.session): Promise<void> {
    if (!session) return Promise.resolve();
    const serialized = JSON.stringify(session, null, 2);
    const run = this.persistQueue.then(async () => {
      try {
        await this.writeSessionFile(serialized);
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
    // Unique per-write temp name (pid + random) so two SessionStore
    // instances for the same workspace never collide on one temp file.
    const tmp = `${this.currentPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, serialized, 'utf-8');
      await fs.rename(tmp, this.currentPath);
      if (process.env.PULSE_CANVAS_PERF) {
        console.log(`[perf] session-persist ${JSON.stringify({ bytes: Buffer.byteLength(serialized, 'utf-8') })}`);
      }
    } catch (err) {
      await fs.unlink(tmp).catch(() => undefined);
      console.error('[session-store] Failed to persist session:', err);
      throw err;
    }
  }

  private async readCurrentSessionFile(): Promise<{
    raw: string;
    session: CanvasAgentSession;
  } | null> {
    let raw: string;
    try {
      raw = await fs.readFile(this.currentPath, 'utf-8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }

    let session: CanvasAgentSession;
    try {
      session = JSON.parse(raw) as CanvasAgentSession;
    } catch (error) {
      throw new Error(
        `Current session is corrupted at ${this.currentPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!session.sessionId || !Array.isArray(session.messages)) {
      throw new Error(`Current session is corrupted at ${this.currentPath}: invalid session shape`);
    }
    return { raw, session };
  }

  private async writeArchiveFile(session: CanvasAgentSession, raw: string): Promise<void> {
    await fs.mkdir(this.archiveDir, { recursive: true });
    const date = session.startedAt.slice(0, 10);
    const sessionId = session.sessionId
      .replace(/[^a-zA-Z0-9._-]/g, '_')
      .slice(0, 120) || 'session';
    const archivePath = join(this.archiveDir, `${date}-${sessionId}-${randomUUID()}.json`);
    const tmp = `${archivePath}.${process.pid}.${randomUUID()}.tmp`;
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      handle = await fs.open(tmp, 'wx');
      await handle.writeFile(raw, 'utf-8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await fs.rename(tmp, archivePath);
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
        await fs.unlink(this.currentPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }
    return current.session;
  }
}

async function loadManifest(): Promise<WorkspaceManifest> {
  try {
    const raw = await fs.readFile(join(storeDir(), '__workspaces__.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const workspaces = (parsed.workspaces ?? parsed.entries ?? []) as WorkspaceManifest['workspaces'];
    return { workspaces, activeId: parsed.activeId as string | undefined };
  } catch {
    return { workspaces: [] };
  }
}

function findPreviousUserMessage(messages: CanvasAgentMessage[], assistantIndex: number): CanvasAgentMessage | undefined {
  for (let index = assistantIndex - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') return messages[index];
  }
  return undefined;
}
