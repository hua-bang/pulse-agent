import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ConversationSnapshot, EntityRecord, JsonObject, PulseStorage } from '@pulse-coder/storage';
import { isStorageError, StorageError } from '@pulse-coder/storage';
import type { AgentScope, CanvasAgentMessage, CanvasAgentSession } from './types';
import { decodeSession, encodeSessionMessages, encodeSessionMetadata, sessionJson, sessionListEntry } from './sqlite-session-codec';
import { listSqliteConversations } from './sqlite-session-backend';
import type { AgentSessionListEntry } from './session-file-summary';

/** Logical JSON payload bytes written by this commit, not SQLite/WAL allocation. */
function recordSessionPersist(metadata: JsonObject, messages: readonly EntityRecord[]): void {
  if (!process.env.PULSE_CANVAS_PERF) return;
  const bytes = Buffer.byteLength(JSON.stringify(metadata), 'utf8')
    + messages.reduce((total, message) => total + Buffer.byteLength(JSON.stringify(message), 'utf8'), 0);
  console.log(`[perf] session-persist ${JSON.stringify({ bytes })}`);
}

/** The SessionStore strategy for the conversations domain; UI selection remains scope-owned. */
export class SqliteSessionStore {
  private session: CanvasAgentSession | null = null;
  private records = new Map<string, ConversationSnapshot>();
  private tail: Promise<void> = Promise.resolve();
  private persistenceError: unknown;
  private pendingSaves = 0;

  constructor(private storage: PulseStorage, private workspaceId: string, private scope: AgentScope) {}

  private createSession(messages: CanvasAgentMessage[] = []): CanvasAgentSession {
    return {
      sessionId: `session-${Date.now()}-${randomUUID()}`,
      workspaceId: this.workspaceId, scope: this.scope, startedAt: new Date().toISOString(), messages,
    };
  }

  private async clearTrashedCache(): Promise<boolean> {
    if (this.scope.kind !== 'workspace' || !await this.storage.workspaces.getTrashed(this.workspaceId)) return false;
    this.session = null;
    this.records.clear();
    return true;
  }

  private async record(sessionId: string): Promise<ConversationSnapshot | null> {
    const record = await this.storage.conversations.read(this.workspaceId, sessionId);
    if (record) this.records.set(sessionId, record);
    else {
      this.records.delete(sessionId);
      if (this.session?.sessionId === sessionId) this.session = null;
    }
    return record;
  }

  private async adopt(sessionId: string | null): Promise<CanvasAgentSession | null> {
    const record = sessionId ? await this.record(sessionId) : null;
    this.session = record ? decodeSession(record) : null;
    return this.session;
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.pendingSaves += 1;
    const pending = this.tail.then(operation).catch(error => {
      this.persistenceError ??= error;
      throw error;
    }).finally(() => {
      this.pendingSaves -= 1;
    });
    this.tail = pending.catch(() => undefined);
    return pending;
  }

  private save(session: CanvasAgentSession): Promise<void> {
    const messages = encodeSessionMessages(this.workspaceId, session.sessionId, session.messages, {
      previous: this.records.get(session.sessionId)?.messages,
    });
    const frozen = sessionJson({ ...session, messages }) as unknown as CanvasAgentSession;
    return this.enqueue(async () => {
      if (await this.clearTrashedCache()) throw new StorageError('not_found', 'Workspace is in the trash; restore it before writing.');
      const previous = this.records.get(session.sessionId) ?? await this.record(session.sessionId);
      if (!previous) throw new StorageError('not_found', 'This conversation no longer exists; create or reopen a conversation before writing');
      const metadata = encodeSessionMetadata(frozen, previous.metadata);
      const appendOnly = previous.messages.length <= messages.length
        && previous.messages.every((message, index) => isDeepStrictEqual(message, messages[index]));
      if (isDeepStrictEqual(previous.messages, messages) && isDeepStrictEqual(previous.metadata, metadata)) return;
      const writtenMessages = appendOnly ? messages.slice(previous.messages.length) : messages;
      const receipt = await this.storage.conversations.commit({
        scopeId: this.workspaceId,
        sessionId: session.sessionId,
        expectedRevision: previous.revision,
        expectedGeneration: previous.generation,
        metadata,
        ...(appendOnly ? { appendMessages: writtenMessages } : { replaceMessages: writtenMessages }),
      });
      this.records.set(session.sessionId, {
        scopeId: this.workspaceId, sessionId: session.sessionId,
        revision: receipt.revision, generation: receipt.generation, metadata, messages,
      });
      recordSessionPersist(metadata, writtenMessages);
    });
  }

  private async flush(): Promise<void> {
    await this.tail;
    await this.clearTrashedCache();
    const failure = this.persistenceError;
    if (!failure) return;
    this.persistenceError = undefined;
    // Never repair a stale snapshot over a newer revision. A subsequent reload can recover.
    if (this.session && !(isStorageError(failure) && ['revision_conflict', 'not_found'].includes(failure.code))) {
      await this.save(this.session).catch(() => undefined);
    }
    throw failure;
  }

  async startSession(): Promise<void> {
    await this.flush();
    const pointer = await this.storage.conversationScopes.read(this.workspaceId);
    const current = pointer?.currentSessionId ? await this.record(pointer.currentSessionId) : null;
    if (this.session?.messages.length === 0 && current?.messages.length === 0) {
      await this.adopt(current.sessionId);
      return;
    }
    const next = this.createSession();
    await this.storage.conversationScopes.commit({
      scopeId: this.workspaceId, expectedRevision: pointer?.revision ?? null, expectedGeneration: this.storage.generation,
      currentSessionId: next.sessionId,
      conversations: [{ sessionId: next.sessionId, expectedRevision: null, metadata: encodeSessionMetadata(next), appendMessages: [] }],
      ...(current?.messages.length === 0 ? { removeConversations: [{ sessionId: current.sessionId, expectedRevision: current.revision }] } : {}),
    });
    recordSessionPersist(encodeSessionMetadata(next), []);
    await this.adopt(next.sessionId);
  }

  async restoreCurrentSession(): Promise<CanvasAgentSession | null> {
    await this.flush();
    const pointer = await this.storage.conversationScopes.read(this.workspaceId);
    return this.adopt(pointer?.currentSessionId ?? null);
  }

  async restoreLastSession(): Promise<CanvasAgentSession | null> {
    const current = await this.restoreCurrentSession();
    if (current?.messages.length) return current;
    const [latest] = await this.listArchivedSessions();
    if (latest) this.session = await this.readSession(latest.sessionId);
    return this.session ?? current;
  }

  addMessage(message: CanvasAgentMessage): void {
    if (!this.session) return;
    this.session.messages.push(message);
    void this.save(this.session).catch(() => undefined);
  }

  setMessages(messages: CanvasAgentMessage[]): void {
    if (!this.session) return;
    this.session.messages = messages;
    void this.save(this.session).catch(() => undefined);
  }

  getMessages(): CanvasAgentMessage[] { return this.session?.messages ?? []; }
  getCurrentSession(): CanvasAgentSession | null { return this.session; }

  private async refreshCleanSession(sessionId: string): Promise<CanvasAgentSession | null> {
    const cached = this.records.get(sessionId);
    const current = this.session?.sessionId === sessionId ? this.session : null;
    const tail = this.tail;
    const assertClean = () => {
      const unchanged = !current || (this.session === current && cached
        && isDeepStrictEqual(sessionJson(current), sessionJson(decodeSession(cached))));
      if (this.pendingSaves || this.persistenceError || this.tail !== tail
        || this.records.get(sessionId) !== cached || !unchanged) {
        throw new StorageError('storage_busy', 'Conversation has pending changes; finish or reload them before refreshing its stored revision.');
      }
    };
    assertClean();
    const fresh = await this.storage.conversations.read(this.workspaceId, sessionId);
    assertClean();
    if (!fresh) {
      this.records.delete(sessionId);
      if (current) this.session = null;
      return null;
    }
    if (fresh.revision !== cached?.revision || fresh.generation !== cached?.generation) {
      if (!cached || !isDeepStrictEqual(fresh.metadata, cached.metadata)
        || !isDeepStrictEqual(fresh.messages, cached.messages)) {
        throw new StorageError('revision_conflict', 'Stored conversation content changed; reload it before continuing.');
      }
      this.records.set(sessionId, fresh);
      if (current) this.session = decodeSession(fresh);
    }
    return decodeSession(fresh);
  }

  async readSession(sessionId: string, refreshIfClean = false): Promise<CanvasAgentSession | null> {
    if (refreshIfClean) return this.refreshCleanSession(sessionId);
    await this.flush();
    const record = await this.record(sessionId);
    return record ? decodeSession(record) : null;
  }

  async appendToSession(sessionId: string, messages: CanvasAgentMessage[]): Promise<void> {
    if (!messages.length) return;
    await this.flush();
    const record = this.records.get(sessionId) ?? await this.record(sessionId);
    if (!record) throw new StorageError('not_found', 'This conversation no longer exists');
    const session = decodeSession(record);
    session.messages.push(...messages);
    await this.save(session);
    if (this.session?.sessionId === sessionId) this.session = session;
  }

  async replaceMessagesInSession(sessionId: string, messages: CanvasAgentMessage[]): Promise<void> {
    await this.flush();
    const record = this.records.get(sessionId) ?? await this.record(sessionId);
    if (!record) throw new StorageError('not_found', 'This conversation no longer exists');
    const session = decodeSession(record);
    session.messages = [...messages];
    await this.save(session);
    if (this.session?.sessionId === sessionId) this.session = session;
  }

  async createConversationById(sessionId: string, messages: CanvasAgentMessage[]): Promise<void> {
    await this.flush();
    const session = { ...this.createSession(), sessionId, messages: [...messages] };
    const encoded = encodeSessionMessages(this.workspaceId, sessionId, session.messages);
    const pointer = await this.storage.conversationScopes.read(this.workspaceId);
    await this.storage.conversationScopes.commit({
      scopeId: this.workspaceId, expectedRevision: pointer?.revision ?? null, expectedGeneration: this.storage.generation,
      conversations: [{ sessionId, expectedRevision: null, metadata: encodeSessionMetadata(session), appendMessages: encoded }],
    });
    recordSessionPersist(encodeSessionMetadata(session), encoded);
    await this.record(sessionId);
  }

  truncateMessages(fromIndex: number): void {
    if (!this.session || fromIndex < 0 || fromIndex >= this.session.messages.length) return;
    this.session.messages.length = fromIndex;
    void this.save(this.session).catch(() => undefined);
  }

  async archiveSession(): Promise<void> {
    await this.flush();
    const pointer = await this.storage.conversationScopes.read(this.workspaceId);
    if (!pointer) { this.session = null; return; }
    const current = pointer.currentSessionId ? await this.record(pointer.currentSessionId) : null;
    await this.storage.conversationScopes.commit({
      scopeId: this.workspaceId, expectedRevision: pointer.revision, expectedGeneration: pointer.generation, currentSessionId: null,
      ...(current?.messages.length === 0 ? { removeConversations: [{ sessionId: current.sessionId, expectedRevision: current.revision }] } : {}),
    });
    this.session = null;
  }

  async branchSession(fromIndex: number): Promise<{ sourceSessionId: string; session: CanvasAgentSession } | null> {
    await this.flush();
    if (!this.session) return null;
    const source = this.records.get(this.session.sessionId) ?? await this.record(this.session.sessionId);
    if (!source) return null;
    const count = Number.isFinite(fromIndex) ? Math.max(0, Math.min(Math.trunc(fromIndex), this.session.messages.length)) : this.session.messages.length;
    const next = this.createSession(this.session.messages.slice(0, count));
    const messages = encodeSessionMessages(this.workspaceId, next.sessionId, next.messages);
    const pointer = await this.storage.conversationScopes.read(this.workspaceId);
    await this.storage.conversationScopes.commit({
      scopeId: this.workspaceId, expectedRevision: pointer?.revision ?? null, expectedGeneration: source.generation,
      currentSessionId: next.sessionId,
      assertConversations: [{ sessionId: source.sessionId, expectedRevision: source.revision }],
      conversations: [{ sessionId: next.sessionId, expectedRevision: null, metadata: encodeSessionMetadata(next), appendMessages: messages }],
    });
    recordSessionPersist(encodeSessionMetadata(next), messages);
    return { sourceSessionId: source.sessionId, session: (await this.adopt(next.sessionId))! };
  }

  private async patchMetadata(sessionId: string, patch: JsonObject): Promise<boolean> {
    await this.flush();
    const record = await this.record(sessionId);
    if (!record) return false;
    const metadata = { ...record.metadata, ...patch };
    const receipt = await this.storage.conversations.commit({
      scopeId: this.workspaceId, sessionId, expectedRevision: record.revision, expectedGeneration: record.generation, metadata,
    });
    this.records.set(sessionId, { ...record, metadata, revision: receipt.revision });
    recordSessionPersist(metadata, []);
    return true;
  }

  renameSession(sessionId: string, title: string): Promise<boolean> {
    return title.trim() ? this.patchMetadata(sessionId, { title: title.trim() }) : Promise.resolve(false);
  }

  setSessionPinned(sessionId: string, pinned: boolean): Promise<boolean> { return this.patchMetadata(sessionId, { pinned }); }

  async listSessions(): Promise<AgentSessionListEntry[]> {
    await this.flush();
    const pointer = await this.storage.conversationScopes.read(this.workspaceId);
    const currentSessionId = this.session?.sessionId ?? pointer?.currentSessionId ?? null;
    return (await listSqliteConversations(this.storage, this.workspaceId))
      .map(record => sessionListEntry(record, currentSessionId)).filter(entry => entry.messageCount > 0)
      .sort((left, right) => Number(right.isCurrent) - Number(left.isCurrent) || right.updatedAt - left.updatedAt || right.date.localeCompare(left.date));
  }

  async listArchivedSessions(): Promise<Array<Omit<AgentSessionListEntry, 'isCurrent'>>> {
    return (await this.listSessions()).filter(entry => !entry.isCurrent).map(({ isCurrent: _current, ...entry }) => entry);
  }

  async readArchivedSession(date: string): Promise<CanvasAgentSession | null> {
    await this.flush();
    const pointer = await this.storage.conversationScopes.read(this.workspaceId);
    const candidates = (await listSqliteConversations(this.storage, this.workspaceId))
      .filter(record => record.sessionId !== pointer?.currentSessionId && (record.metadata.date === date
        || (Array.isArray(record.metadata.archiveKeys) && record.metadata.archiveKeys.includes(date))))
      .sort((left, right) => Number(right.metadata.updatedAt ?? 0) - Number(left.metadata.updatedAt ?? 0));
    return candidates[0] ? this.readSession(candidates[0].sessionId) : null;
  }

  async loadSession(sessionId: string): Promise<CanvasAgentSession | null> {
    await this.flush();
    const record = await this.record(sessionId);
    if (!record) return null;
    const pointer = await this.storage.conversationScopes.read(this.workspaceId);
    if (pointer?.currentSessionId !== sessionId) {
      const old = pointer?.currentSessionId ? await this.record(pointer.currentSessionId) : null;
      await this.storage.conversationScopes.commit({
        scopeId: this.workspaceId, expectedRevision: pointer?.revision ?? null, expectedGeneration: record.generation, currentSessionId: sessionId,
        ...(old?.messages.length === 0 ? { removeConversations: [{ sessionId: old.sessionId, expectedRevision: old.revision }] } : {}),
      });
    }
    return this.adopt(sessionId);
  }

  async deleteSession(sessionId: string): Promise<{ deletedCurrent: boolean; activeSession: CanvasAgentSession } | null> {
    await this.flush();
    const record = await this.record(sessionId);
    if (!record) return null;
    const pointer = await this.storage.conversationScopes.read(this.workspaceId);
    const deletedCurrent = sessionId === this.session?.sessionId || sessionId === pointer?.currentSessionId;
    const next = deletedCurrent || !pointer?.currentSessionId ? this.createSession() : null;
    await this.storage.conversationScopes.commit({
      scopeId: this.workspaceId, expectedRevision: pointer?.revision ?? null, expectedGeneration: record.generation,
      ...(next ? {
        currentSessionId: next.sessionId,
        conversations: [{ sessionId: next.sessionId, expectedRevision: null, metadata: encodeSessionMetadata(next), appendMessages: [] }],
      } : {}),
      removeConversations: [{ sessionId, expectedRevision: record.revision }],
    });
    this.records.delete(sessionId);
    if (next) recordSessionPersist(encodeSessionMetadata(next), []);
    return { deletedCurrent, activeSession: (await this.adopt(next?.sessionId ?? pointer!.currentSessionId))! };
  }
}
