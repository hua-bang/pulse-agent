import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system' | 'clarification';
  content: string;
  timestamp: number;
  metadata?: {
    clarificationType?: 'question' | 'answer';
    clarificationId?: string;
    [key: string]: any;
  };
}

export interface Session {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: SessionMessage[];
  metadata: {
    totalMessages: number;
    lastMessageAt?: number;
    tags?: string[];
    taskListId?: string;
    /** Working directory the session was created in; scopes the session lists. */
    cwd?: string;
  };
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  preview: string;
  taskListId?: string;
  cwd?: string;
}

export interface ListSessionsOptions {
  limit?: number;
  /** Only sessions created in this directory. Legacy sessions (no cwd) always pass. */
  cwd?: string;
}

/**
 * Extracts human-readable text from a stored message content value.
 * Context messages are AI SDK ModelMessages: content may be a plain string or
 * an array of parts (text / tool-call / tool-result). Non-text parts yield ''.
 */
export function extractMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string') {
          return (part as { text: string }).text;
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  if (content && typeof content === 'object' && typeof (content as { text?: unknown }).text === 'string') {
    return (content as { text: string }).text;
  }
  return '';
}

export class SessionManager {
  private sessionsDir: string;

  constructor() {
    this.sessionsDir = path.join(homedir(), '.pulse-coder', 'sessions');
  }

  private buildTaskListId(sessionId: string): string {
    return `session-${sessionId}`;
  }

  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
    } catch (error) {
      // Directory might already exist
    }
  }

  async createSession(title?: string, cwd = process.cwd()): Promise<Session> {
    const sessionId = randomUUID();
    const session: Session = {
      id: sessionId,
      title: title || `Session ${new Date().toLocaleString()}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      metadata: {
        totalMessages: 0,
        taskListId: this.buildTaskListId(sessionId),
        cwd,
      },
    };

    await this.saveSession(session);
    return session;
  }

  async saveSession(session: Session): Promise<void> {
    session.updatedAt = Date.now();
    session.metadata.totalMessages = session.messages.length;
    if (session.messages.length > 0) {
      session.metadata.lastMessageAt = session.messages[session.messages.length - 1].timestamp;
    }

    const filePath = path.join(this.sessionsDir, `${session.id}.json`);
    const payload = JSON.stringify(session, null, 2);

    // Write-then-rename, not write-in-place: a plain writeFile truncates first,
    // so a process killed mid-write (a second Ctrl+C racing the shutdown save, a
    // SIGTERM, a full disk) leaves the whole conversation as an empty or
    // half-written file. rename(2) is atomic within a directory, so a reader
    // sees either the old session or the new one — never a torn one.
    const tempPath = `${filePath}.${process.pid}.tmp`;
    try {
      await fs.writeFile(tempPath, payload);
      await fs.rename(tempPath, filePath);
    } catch (error) {
      await fs.rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async loadSession(id: string): Promise<Session | null> {
    try {
      const filePath = path.join(this.sessionsDir, `${id}.json`);
      const data = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return null;
    }
  }

  /** Last user/assistant message with extractable text, compacted for list previews. */
  private buildPreview(messages: SessionMessage[]): string {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== 'user' && message.role !== 'assistant') {
        continue;
      }
      const text = extractMessageText(message.content).replace(/\s+/g, ' ').trim();
      if (text) {
        return text.length > 100 ? `${text.slice(0, 100)}…` : text;
      }
    }
    return messages.length > 0 ? '(no text messages)' : 'No messages';
  }

  /**
   * Lists sessions newest-first. With `cwd` set, only sessions created in that
   * directory are returned; sessions written before cwd was recorded have no
   * `cwd` and are always included rather than silently disappearing.
   */
  async listSessions(options: number | ListSessionsOptions = {}): Promise<SessionSummary[]> {
    const { limit = 20, cwd } = typeof options === 'number' ? { limit: options } : options;
    try {
      const files = await fs.readdir(this.sessionsDir);
      const sessionFiles = files.filter(file => file.endsWith('.json'));

      const sessions: Session[] = [];
      for (const file of sessionFiles) {
        try {
          const data = await fs.readFile(path.join(this.sessionsDir, file), 'utf-8');
          sessions.push(JSON.parse(data));
        } catch {
          continue;
        }
      }

      return sessions
        .filter(session => !cwd || !session.metadata?.cwd || session.metadata.cwd === cwd)
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, limit)
        .map(session => ({
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: session.messages.length,
          preview: this.buildPreview(session.messages),
          taskListId: session.metadata?.taskListId,
          cwd: session.metadata?.cwd,
        }));
    } catch (error) {
      return [];
    }
  }

  async deleteSession(id: string): Promise<boolean> {
    try {
      const filePath = path.join(this.sessionsDir, `${id}.json`);
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      return false;
    }
  }

  async updateSessionTitle(id: string, title: string): Promise<boolean> {
    const session = await this.loadSession(id);
    if (!session) return false;

    session.title = title;
    await this.saveSession(session);
    return true;
  }

  async addMessage(id: string, message: Omit<SessionMessage, 'timestamp'>): Promise<boolean> {
    const session = await this.loadSession(id);
    if (!session) return false;

    session.messages.push({
      ...message,
      timestamp: Date.now(),
    });

    await this.saveSession(session);
    return true;
  }

  async searchSessions(query: string, cwd?: string): Promise<SessionSummary[]> {
    const sessions = await this.listSessions({ limit: 100, cwd });
    const lowercaseQuery = query.toLowerCase();
    
    return sessions.filter(session =>
      session.title.toLowerCase().includes(lowercaseQuery) ||
      session.preview.toLowerCase().includes(lowercaseQuery)
    );
  }
}