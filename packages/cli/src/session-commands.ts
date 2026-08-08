import { extractMessageText, SessionManager, type Session, type SessionSummary } from './session.js';
import type { Context } from 'pulse-coder-engine';

export class SessionCommands {
  private sessionManager: SessionManager;
  private currentSessionId: string | null = null;
  private currentTaskListId: string | null = null;
  /** Session lists are scoped to the directory the CLI was started in. */
  private readonly cwd: string;

  constructor(private readonly log: (message?: string) => void = console.log, cwd = process.cwd()) {
    this.sessionManager = new SessionManager();
    this.cwd = cwd;
  }

  async initialize(): Promise<void> {
    await this.sessionManager.initialize();
  }

  getCurrentSessionId(): string | null {
    return this.currentSessionId;
  }

  getCurrentTaskListId(): string | null {
    return this.currentTaskListId;
  }

  private buildSessionTaskListId(sessionId: string): string {
    return `session-${sessionId}`;
  }

  private async ensureSessionTaskListId(session: Session): Promise<string> {
    if (!session.metadata) {
      session.metadata = { totalMessages: session.messages?.length ?? 0 };
    }

    const existing = session.metadata.taskListId?.trim();
    if (existing) {
      return existing;
    }

    const generated = this.buildSessionTaskListId(session.id);
    session.metadata.taskListId = generated;
    await this.sessionManager.saveSession(session);

    return generated;
  }

  async createSession(title?: string): Promise<string> {
    const session = await this.sessionManager.createSession(title);
    this.currentSessionId = session.id;
    this.currentTaskListId = await this.ensureSessionTaskListId(session);
    this.log(`\n✅ New session created: ${session.title} (ID: ${session.id})`);
    this.log(`🗂️ Task list: ${this.currentTaskListId}`);
    return session.id;
  }


  /**
   * Resolve a user-facing session reference to a real session id.
   * Accepts: exact id, 1-based index into the `/sessions` listing (most recent
   * first), or a unique id prefix (>= 4 chars).
   */
  private async resolveSessionRef(ref: string): Promise<{ id?: string; reason?: string }> {
    const trimmed = ref.trim();
    if (!trimmed) {
      return { reason: 'Empty session reference' };
    }

    if (await this.sessionManager.loadSession(trimmed)) {
      return { id: trimmed };
    }

    const sessions = await this.sessionManager.listSessions({ limit: 100, cwd: this.cwd });

    if (/^\d{1,3}$/.test(trimmed)) {
      const index = Number(trimmed) - 1;
      const match = sessions[index];
      return match
        ? { id: match.id }
        : { reason: `Index ${trimmed} is out of range (${sessions.length} sessions)` };
    }

    if (trimmed.length >= 4) {
      const prefixMatches = sessions.filter(session => session.id.startsWith(trimmed));
      if (prefixMatches.length === 1) {
        return { id: prefixMatches[0].id };
      }
      if (prefixMatches.length > 1) {
        return { reason: `Prefix "${trimmed}" matches ${prefixMatches.length} sessions; be more specific` };
      }
    }

    return { reason: `Session not found: ${trimmed}` };
  }

  /** Sessions offered by the interactive picker: non-empty, excluding the active one. */
  async listForPicker(limit = 50): Promise<SessionSummary[]> {
    const sessions = await this.sessionManager.listSessions({ limit, cwd: this.cwd });
    return sessions.filter(session => session.messageCount > 0 && session.id !== this.currentSessionId);
  }

  async resumeLatest(): Promise<boolean> {
    const [latest] = await this.sessionManager.listSessions({ limit: 1, cwd: this.cwd });
    if (!latest) {
      return false;
    }
    return this.resumeSession(latest.id);
  }

  async resumeSession(ref: string): Promise<boolean> {
    const resolved = await this.resolveSessionRef(ref);
    if (!resolved.id) {
      this.log(`\n❌ ${resolved.reason}`);
      return false;
    }

    const session = await this.sessionManager.loadSession(resolved.id);
    if (!session) {
      this.log(`\n❌ Session not found: ${resolved.id}`);
      return false;
    }

    this.currentSessionId = session.id;
    this.currentTaskListId = await this.ensureSessionTaskListId(session);
    this.log(`\n✅ Resumed session: ${session.title} (ID: ${session.id})`);
    this.log(`🗂️ Task list: ${this.currentTaskListId}`);
    this.log(`📊 Loaded ${session.messages.length} messages`);

    // Show the last few text-bearing turns as context (tool traffic skipped)
    const recentMessages = session.messages
      .filter(msg => (msg.role === 'user' || msg.role === 'assistant') && extractMessageText(msg.content).trim())
      .slice(-5);
    if (recentMessages.length > 0) {
      this.log('\n💬 Recent conversation:');
      recentMessages.forEach((msg, index) => {
        const role = msg.role === 'user' ? '👤 You' : '🤖 Assistant';
        const contentStr = extractMessageText(msg.content).replace(/\s+/g, ' ').trim();
        const preview = contentStr.substring(0, 100) + (contentStr.length > 100 ? '…' : '');
        this.log(`${index + 1}. ${role}: ${preview}`);
      });
    }

    return true;
  }

  /** Prints the most recent sessions. Bounded by default so a long history cannot flood the transcript. */
  async listSessions(limit = 20, options: { allDirectories?: boolean } = {}): Promise<void> {
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 20;
    const allSessions = await this.sessionManager.listSessions({
      limit: Math.max(normalizedLimit, 200),
      ...(options.allDirectories ? {} : { cwd: this.cwd }),
    });
    const sessions = allSessions.slice(0, normalizedLimit);

    if (sessions.length === 0) {
      this.log('\n📭 No saved sessions found.');
      return;
    }

    const scope = options.allDirectories ? 'all directories' : this.cwd;
    this.log(`\n📋 Saved sessions (showing ${sessions.length} of ${allSessions.length} · ${scope}):`);
    this.log('='.repeat(80));

    sessions.forEach((session, index) => {
      const isActive = session.id === this.currentSessionId ? '✅' : '  ';
      const date = new Date(session.updatedAt).toLocaleString();
      this.log(`${index + 1}. ${isActive} ${session.title}`);
      this.log(`   ID: ${session.id}`);
      this.log(`   Messages: ${session.messageCount} | Updated: ${date}`);
      if (session.taskListId) {
        this.log(`   Task List: ${session.taskListId}`);
      }
      this.log(`   Preview: ${session.preview}`);
      this.log();
    });
    if (allSessions.length > sessions.length) {
      this.log(`… ${allSessions.length - sessions.length} older sessions hidden · /sessions <n> shows more`);
    }
    if (!options.allDirectories) {
      this.log('Scoped to this directory · /sessions --all lists every directory.');
    }
    this.log('Resume with /resume <index>, a unique id prefix, or the full id.');
  }

  /**
   * Auto-title a session from its first user message, but only while it still
   * carries the default "Session <date>" title — explicit titles are kept.
   */
  async maybeAutoTitle(firstUserText: string): Promise<void> {
    if (!this.currentSessionId) {
      return;
    }

    const session = await this.sessionManager.loadSession(this.currentSessionId);
    if (!session || !/^Session /.test(session.title)) {
      return;
    }

    const title = firstUserText.replace(/\s+/g, ' ').trim().slice(0, 48);
    if (!title) {
      return;
    }

    await this.sessionManager.updateSessionTitle(this.currentSessionId, title);
  }

  async saveContext(context: Context): Promise<void> {
    if (!this.currentSessionId) return;

    const session = await this.sessionManager.loadSession(this.currentSessionId);
    if (!session) return;

    if (this.currentTaskListId) {
      session.metadata.taskListId = this.currentTaskListId;
    }

    // Sync messages from context
    session.messages = context.messages.map(msg => ({
      ...msg,
      timestamp: Date.now(),
    }));

    await this.sessionManager.saveSession(session);
  }

  async loadContext(context: Context): Promise<void> {
    if (!this.currentSessionId) return;

    const session = await this.sessionManager.loadSession(this.currentSessionId);
    if (!session) return;

    this.currentTaskListId = await this.ensureSessionTaskListId(session);

    // Load messages into context
    context.messages = session.messages.map(msg => ({
      ...msg
    }));
  }

  async searchSessions(query: string): Promise<void> {
    const sessions = await this.sessionManager.searchSessions(query, this.cwd);

    if (sessions.length === 0) {
      this.log(`\n🔍 No sessions found matching "${query}"`);
      return;
    }

    this.log(`\n🔍 Search results for "${query}":`);
    sessions.forEach((session, index) => {
      this.log(`${index + 1}. ${session.title} (${session.id}) - ${session.messageCount} messages`);
      this.log(`   Updated: ${new Date(session.updatedAt).toLocaleString()}`);
      this.log(`   Preview: ${session.preview}`);
    });
  }

  async deleteSession(id: string): Promise<boolean> {
    const success = await this.sessionManager.deleteSession(id);
    if (success) {
      this.log(`\n🗑️ Session ${id} deleted`);
      if (this.currentSessionId === id) {
        this.currentSessionId = null;
        this.currentTaskListId = null;
      }
    } else {
      this.log(`\n❌ Failed to delete session ${id}`);
    }
    return success;
  }

  async renameSession(id: string, newTitle: string): Promise<boolean> {
    const success = await this.sessionManager.updateSessionTitle(id, newTitle);
    if (success) {
      this.log(`\n✅ Session ${id} renamed to "${newTitle}"`);
    } else {
      this.log(`\n❌ Failed to rename session ${id}`);
    }
    return success;
  }
}