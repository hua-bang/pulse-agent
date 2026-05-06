import { SessionManager, type Session } from './session.js';
import type { Context } from 'pulse-coder-engine';

export class SessionCommands {
  private sessionManager: SessionManager;
  private currentSessionId: string | null = null;
  private currentTaskListId: string | null = null;

  constructor(private readonly log: (message?: string) => void = console.log) {
    this.sessionManager = new SessionManager();
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


  async resumeSession(id: string): Promise<boolean> {
    const session = await this.sessionManager.loadSession(id);
    if (!session) {
      this.log(`\n❌ Session not found: ${id}`);
      return false;
    }

    this.currentSessionId = session.id;
    this.currentTaskListId = await this.ensureSessionTaskListId(session);
    this.log(`\n✅ Resumed session: ${session.title} (ID: ${session.id})`);
    this.log(`🗂️ Task list: ${this.currentTaskListId}`);
    this.log(`📊 Loaded ${session.messages.length} messages`);

    // Show last few messages as context
    const recentMessages = session.messages.slice(-5);
    if (recentMessages.length > 0) {
      this.log('\n💬 Recent conversation:');
      recentMessages.forEach((msg, index) => {
        const role = msg.role === 'user' ? '👤 You' : '🤖 Assistant';
        const contentStr = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
        const preview = contentStr.substring(0, 100) + (contentStr.length > 100 ? '...' : '');
        this.log(`${index + 1}. ${role}: ${preview}`);
      });
    }

    return true;
  }

  async listSessions(): Promise<void> {
    const sessions = await this.sessionManager.listSessions();

    if (sessions.length === 0) {
      this.log('\n📭 No saved sessions found.');
      return;
    }

    this.log('\n📋 Saved sessions:');
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
    const sessions = await this.sessionManager.searchSessions(query);

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