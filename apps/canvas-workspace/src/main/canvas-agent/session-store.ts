/**
 * Session persistence for the Canvas Agent.
 *
 * Storage layout:
 *   ~/.pulse-coder/canvas/<workspace-id>/agent-sessions/
 *   ├── current.json          ← active session
 *   └── archive/
 *       ├── 2026-04-08.json   ← archived sessions by date
 *       └── 2026-04-07.json
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type {
  CanvasAgentDebugRunDetail,
  CanvasAgentDebugRunSummary,
  CanvasAgentMessage,
  CanvasAgentSession,
} from './types';

const STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');

interface WorkspaceManifest {
  workspaces: Array<{ id: string; name: string }>;
  activeId?: string;
}

interface SessionWithMeta {
  session: CanvasAgentSession;
  workspaceName: string;
  isCurrent: boolean;
  sortKey: number;
}

function archiveFileTimestamp(file: string): number {
  const match = file.match(/-(\d+)\.json$/);
  return match ? Number(match[1]) : 0;
}

async function archiveSortKey(filePath: string, fileName: string): Promise<number> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mtimeMs;
  } catch {
    return archiveFileTimestamp(fileName);
  }
}

export class SessionStore {
  private workspaceId: string;
  private sessionsDir: string;
  private currentPath: string;
  private archiveDir: string;

  private session: CanvasAgentSession | null = null;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
    this.sessionsDir = join(STORE_DIR, workspaceId, 'agent-sessions');
    this.currentPath = join(this.sessionsDir, 'current.json');
    this.archiveDir = join(this.sessionsDir, 'archive');
  }

  /**
   * Start a new session. If a current session exists, archive it first.
   */
  async startSession(): Promise<void> {
    await fs.mkdir(this.sessionsDir, { recursive: true });
    await fs.mkdir(this.archiveDir, { recursive: true });

    // Archive any existing current session
    await this.archiveCurrentIfExists();

    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.session = {
      sessionId,
      workspaceId: this.workspaceId,
      startedAt: new Date().toISOString(),
      messages: [],
    };

    await this.persist();
  }

  /**
   * Add a message to the current session and persist.
   */
  addMessage(message: CanvasAgentMessage): void {
    if (!this.session) return;
    this.session.messages.push(message);
    // Fire-and-forget persist
    void this.persist();
  }

  /**
   * Get all messages from the current session.
   */
  getMessages(): CanvasAgentMessage[] {
    return this.session?.messages ?? [];
  }

  /**
   * Archive the current session and clear it.
   */
  async archiveSession(): Promise<void> {
    await this.archiveCurrentIfExists();
    this.session = null;
  }

  /**
   * List archived sessions (date + message count).
   */
  async listArchivedSessions(): Promise<Array<{ sessionId: string; date: string; messageCount: number; preview: string }>> {
    try {
      const files = await fs.readdir(this.archiveDir);
      const currentSessionId = this.session?.sessionId;
      const sessionsById = new Map<string, { sessionId: string; date: string; messageCount: number; preview: string; sortKey: number }>();

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
            preview: firstUserMsg ? firstUserMsg.content.slice(0, 50) : '',
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

  /**
   * Read a specific archived session by date.
   */
  async readArchivedSession(date: string): Promise<CanvasAgentSession | null> {
    try {
      const raw = await fs.readFile(join(this.archiveDir, `${date}.json`), 'utf-8');
      return JSON.parse(raw) as CanvasAgentSession;
    } catch {
      return null;
    }
  }

  /**
   * Get the current session metadata (for listing alongside archived ones).
   */
  getCurrentSession(): CanvasAgentSession | null {
    return this.session;
  }

  /**
   * Load an archived session as the current session (for viewing/resuming).
   * Archives the current session first if it has messages.
   */
  async loadSession(sessionId: string): Promise<CanvasAgentSession | null> {
    // If the requested session is already current, do not create another copy.
    if (this.session?.sessionId === sessionId) {
      await this.removeArchivedSessionsById(sessionId);
      return this.session;
    }

    try {
      const raw = await fs.readFile(this.currentPath, 'utf-8');
      const current = JSON.parse(raw) as CanvasAgentSession;
      if (current.sessionId === sessionId) {
        this.session = current;
        await this.removeArchivedSessionsById(sessionId);
        return current;
      }
    } catch {
      // No current session on disk or it is unreadable.
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
    this.session = matched;
    await this.persist();
    await this.removeArchivedSessionsById(sessionId);
    return matched;
  }

  // ─── Cross-workspace scanning ────────────────────────────────

  /**
   * Scan all workspace directories and return sessions grouped by workspace.
   * Reads current.json + archive/ for each workspace found under STORE_DIR.
   */
  static async listAllWorkspaceSessions(): Promise<
    Array<{
      workspaceId: string;
      sessions: Array<{ sessionId: string; date: string; messageCount: number; preview: string; isCurrent: boolean }>;
    }>
  > {
    const results: Array<{
      workspaceId: string;
      sessions: Array<{ sessionId: string; date: string; messageCount: number; preview: string; isCurrent: boolean }>;
    }> = [];

    let dirs: string[];
    try {
      dirs = await fs.readdir(STORE_DIR);
    } catch {
      return results;
    }

    for (const dir of dirs) {
      // Skip manifest and non-directory entries
      if (dir.startsWith('__') || dir.startsWith('.')) continue;

      const sessionsDir = join(STORE_DIR, dir, 'agent-sessions');
      const archiveDir = join(sessionsDir, 'archive');
      const currentPath = join(sessionsDir, 'current.json');

      const sessions: Array<{ sessionId: string; date: string; messageCount: number; preview: string; isCurrent: boolean }> = [];

      // Read current session
      try {
        const raw = await fs.readFile(currentPath, 'utf-8');
        const data = JSON.parse(raw) as CanvasAgentSession;
        if (data.messages && data.messages.length > 0) {
          const firstUserMsg = data.messages.find(m => m.role === 'user');
          sessions.push({
            sessionId: data.sessionId,
            date: data.startedAt?.slice(0, 10) || '',
            messageCount: data.messages.length,
            preview: firstUserMsg ? firstUserMsg.content.slice(0, 50) : '',
            isCurrent: true,
          });
        }
      } catch {
        // No current session
      }

      // Read archived sessions
      try {
        const files = await fs.readdir(archiveDir);
        const currentSessionIds = new Set(sessions.filter(s => s.isCurrent).map(s => s.sessionId));
        const archivedById = new Map<string, { sessionId: string; date: string; messageCount: number; preview: string; isCurrent: boolean; sortKey: number }>();

        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          try {
            const archivePath = join(archiveDir, file);
            const raw = await fs.readFile(archivePath, 'utf-8');
            const data = JSON.parse(raw) as CanvasAgentSession;

            // Avoid showing the same session twice when a restored archived
            // session is also present as current.json.
            if (currentSessionIds.has(data.sessionId)) continue;

            const firstUserMsg = data.messages.find(m => m.role === 'user');
            const sortKey = await archiveSortKey(archivePath, file);
            const session = {
              sessionId: data.sessionId,
              date: data.startedAt?.slice(0, 10) || file.replace('.json', '').slice(0, 10),
              messageCount: data.messages.length,
              preview: firstUserMsg ? firstUserMsg.content.slice(0, 50) : '',
              isCurrent: false,
              sortKey,
            };
            const existing = archivedById.get(data.sessionId);
            if (!existing || sortKey > existing.sortKey) {
              archivedById.set(data.sessionId, session);
            }
          } catch {
            // skip corrupted files
          }
        }

        sessions.push(...Array.from(archivedById.values()).map(({ sortKey: _sortKey, ...session }) => session));
      } catch {
        // No archive dir
      }

      if (sessions.length > 0) {
        sessions.sort((a, b) => {
          if (a.isCurrent && !b.isCurrent) return -1;
          if (!a.isCurrent && b.isCurrent) return 1;
          return b.date.localeCompare(a.date);
        });
        results.push({ workspaceId: dir, sessions });
      }
    }

    return results;
  }

  /**
   * Load a session by ID from another workspace's archive (read-only).
   */
  static async readSessionFromWorkspace(
    sourceWorkspaceId: string,
    sessionId: string,
  ): Promise<CanvasAgentSession | null> {
    const sessionsDir = join(STORE_DIR, sourceWorkspaceId, 'agent-sessions');
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

  /**
   * List all persisted Canvas Agent turns that carry a dev debug trace.
   */
  static async listDebugRuns(): Promise<CanvasAgentDebugRunSummary[]> {
    const sessions = await this.readAllSessionsWithMeta();
    const runs = sessions.flatMap(({ session, workspaceName, isCurrent }) => (
      session.messages.flatMap((message, index) => {
        if (message.role !== 'assistant' || !message.debugTrace) return [];
        return [debugRunSummaryFromMessage({
          session,
          workspaceName,
          isCurrent,
          message,
          messageIndex: index,
        })];
      })
    ));

    runs.sort((a, b) => b.startedAt - a.startedAt);
    return runs;
  }

  /**
   * Read a single persisted debug trace by session/run id.
   */
  static async readDebugRun(sessionId: string, runId: string): Promise<CanvasAgentDebugRunDetail | null> {
    const sessions = await this.readAllSessionsWithMeta();
    for (const { session, workspaceName, isCurrent } of sessions) {
      if (session.sessionId !== sessionId) continue;
      const messageIndex = session.messages.findIndex(
        message => message.role === 'assistant' && message.debugTrace?.runId === runId,
      );
      if (messageIndex < 0) continue;

      const assistantMessage = session.messages[messageIndex];
      const trace = assistantMessage.debugTrace;
      if (!trace) continue;

      return {
        ...debugRunSummaryFromMessage({
          session,
          workspaceName,
          isCurrent,
          message: assistantMessage,
          messageIndex,
        }),
        userMessage: findPreviousUserMessage(session.messages, messageIndex),
        assistantMessage,
        trace,
      };
    }

    return null;
  }

  private static async readAllSessionsWithMeta(): Promise<SessionWithMeta[]> {
    const manifest = await loadManifest();
    const workspaceNames = new Map(manifest.workspaces.map(workspace => [workspace.id, workspace.name] as const));
    const results: SessionWithMeta[] = [];

    let dirs: string[];
    try {
      dirs = await fs.readdir(STORE_DIR);
    } catch {
      return results;
    }

    for (const workspaceId of dirs) {
      if (workspaceId.startsWith('__') || workspaceId.startsWith('.')) continue;
      const workspaceName = workspaceNames.get(workspaceId) ?? workspaceId;
      const sessionsDir = join(STORE_DIR, workspaceId, 'agent-sessions');
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

  private async removeArchivedSessionsById(sessionId: string): Promise<void> {
    try {
      const files = await fs.readdir(this.archiveDir);
      await Promise.all(files.map(async (file) => {
        if (!file.endsWith('.json')) return;
        const archivePath = join(this.archiveDir, file);
        try {
          const raw = await fs.readFile(archivePath, 'utf-8');
          const data = JSON.parse(raw) as CanvasAgentSession;
          if (data.sessionId === sessionId) {
            await fs.unlink(archivePath).catch(() => undefined);
          }
        } catch {
          // skip corrupted files
        }
      }));
    } catch {
      // No archive dir
    }
  }

  private async persist(): Promise<void> {
    if (!this.session) return;
    try {
      await fs.writeFile(this.currentPath, JSON.stringify(this.session, null, 2), 'utf-8');
    } catch (err) {
      console.error('[session-store] Failed to persist session:', err);
    }
  }

  private async archiveCurrentIfExists(): Promise<void> {
    try {
      const raw = await fs.readFile(this.currentPath, 'utf-8');
      const existing = JSON.parse(raw) as CanvasAgentSession;

      if (existing.messages.length > 0) {
        // Archive with date-based filename; append timestamp to avoid collisions
        const date = existing.startedAt.slice(0, 10); // YYYY-MM-DD
        const ts = Date.now();
        const archivePath = join(this.archiveDir, `${date}-${ts}.json`);
        await fs.writeFile(archivePath, raw, 'utf-8');
      }

      // Remove current
      await fs.unlink(this.currentPath).catch(() => undefined);
    } catch {
      // No current session or corrupted — nothing to archive
    }
  }
}

async function loadManifest(): Promise<WorkspaceManifest> {
  try {
    const raw = await fs.readFile(join(STORE_DIR, '__workspaces__.json'), 'utf-8');
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

function debugRunSummaryFromMessage(input: {
  session: CanvasAgentSession;
  workspaceName: string;
  isCurrent: boolean;
  message: CanvasAgentMessage;
  messageIndex: number;
}): CanvasAgentDebugRunSummary {
  const { session, workspaceName, isCurrent, message, messageIndex } = input;
  const trace = message.debugTrace!;
  const modelLabel = [trace.model?.provider, trace.model?.model].filter(Boolean).join(' / ') || undefined;
  return {
    workspaceId: session.workspaceId,
    workspaceName,
    sessionId: session.sessionId,
    runId: trace.runId,
    turnId: trace.turnId,
    messageIndex,
    startedAt: trace.startedAt,
    durationMs: trace.durationMs,
    userPromptPreview: trace.request.userPromptPreview,
    assistantPreview: message.content.slice(0, 180),
    toolCount: trace.toolCalls.length,
    readNodeCount: trace.readNodes.length,
    modelLabel,
    isCurrent,
  };
}
