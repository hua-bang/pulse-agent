import type { ConversationScopeCommit, ConversationScopeRepository, ConversationScopeSnapshot } from '../conversation-scopes.js';
import { RevisionConflictError, StorageError } from '../errors.js';
import type { SqliteContext } from './context.js';
import { createConversationOperations } from './conversations.js';
import { decodeCursor, encodeCursor, pageLimit, validateId } from './validation.js';
import { createWorkspaceVisibility } from './workspace-visibility.js';

export const CONVERSATION_SCOPES_SCHEMA = `
  CREATE TABLE conversation_scopes (
    scope_id TEXT PRIMARY KEY NOT NULL,
    current_session_id TEXT,
    revision INTEGER NOT NULL CHECK (revision > 0),
    FOREIGN KEY (scope_id, current_session_id)
      REFERENCES conversations(scope_id, session_id) ON DELETE RESTRICT
  ) STRICT;
`;

interface ScopeRow {
  scope_id: string;
  current_session_id: string | null;
  revision: number;
}

function validateRevision(revision: number | null, allowCreate = false): void {
  if (revision === null && allowCreate) return;
  if (revision === null || !Number.isSafeInteger(revision) || revision < 1) {
    throw new StorageError('invalid_argument', 'Expected revision must be a positive safe integer');
  }
}

function validateInput(input: ConversationScopeCommit): void {
  validateId(input.scopeId, 'scope id');
  validateRevision(input.expectedRevision, true);
  if (input.expectedGeneration !== undefined) validateId(input.expectedGeneration, 'storage generation');
  if (input.currentSessionId !== undefined && input.currentSessionId !== null) validateId(input.currentSessionId, 'current session id');
  for (const entries of [input.conversations, input.removeConversations, input.assertConversations]) {
    if (entries !== undefined && !Array.isArray(entries)) {
      throw new StorageError('invalid_argument', 'Conversation mutations and assertions must be arrays');
    }
  }
  const changed = new Set<string>();
  for (const entry of [...(input.conversations ?? []), ...(input.removeConversations ?? [])]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new StorageError('invalid_argument', 'Each conversation mutation must be an object');
    }
    validateId(entry.sessionId, 'session id');
    if ('scopeId' in entry && entry.scopeId !== input.scopeId) {
      throw new StorageError('invalid_argument', 'A scope commit cannot change another scope');
    }
    if (changed.has(entry.sessionId)) {
      throw new StorageError('invalid_argument', `Duplicate or conflicting conversation mutation: ${entry.sessionId}`);
    }
    changed.add(entry.sessionId);
  }
  for (const entry of [...(input.removeConversations ?? []), ...(input.assertConversations ?? [])]) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new StorageError('invalid_argument', 'Each revision condition must be an object');
    }
    validateId(entry.sessionId, 'session id');
    validateRevision(entry.expectedRevision);
  }
}

export type ConversationScopeOperations = {
  [Method in keyof ConversationScopeRepository]: (...args: Parameters<ConversationScopeRepository[Method]>) => Awaited<ReturnType<ConversationScopeRepository[Method]>>;
};

export function createConversationScopeOperations(ctx: SqliteContext): ConversationScopeOperations {
  const visibility = createWorkspaceVisibility(ctx);
  const readScope = ctx.db.prepare(`
    SELECT scope_id, current_session_id, revision FROM conversation_scopes WHERE scope_id = ?
    AND NOT EXISTS (SELECT 1 FROM workspace_trash WHERE workspace_id = conversation_scopes.scope_id)
  `);
  const listScopes = ctx.db.prepare(`
    SELECT scope_id, current_session_id, revision FROM conversation_scopes
    WHERE scope_id > ? AND NOT EXISTS (SELECT 1 FROM workspace_trash WHERE workspace_id = conversation_scopes.scope_id)
    ORDER BY scope_id LIMIT ?
  `);
  const readRevision = ctx.db.prepare('SELECT revision FROM conversations WHERE scope_id = ? AND session_id = ?');
  const putScope = ctx.db.prepare(`
    INSERT INTO conversation_scopes (scope_id, current_session_id, revision) VALUES (?, ?, ?)
    ON CONFLICT(scope_id) DO UPDATE SET current_session_id = excluded.current_session_id, revision = excluded.revision
  `);
  const conversations = createConversationOperations(ctx);
  const snapshot = (row: ScopeRow): ConversationScopeSnapshot => ({
    scopeId: row.scope_id,
    currentSessionId: row.current_session_id,
    revision: row.revision,
    generation: ctx.generation,
  });
  const commit = (input: ConversationScopeCommit) => {
    if (!ctx.db.inTransaction) throw new StorageError('storage_unavailable', 'Conversation scope mutations require a transaction');
    validateInput(input);
    visibility.assertWritable(input.scopeId);
    if (input.expectedGeneration !== undefined && input.expectedGeneration !== ctx.generation) {
      throw new StorageError('revision_conflict', 'Conversation scope belongs to a different storage generation');
    }
    const previous = readScope.get(input.scopeId) as ScopeRow | undefined;
    const actualRevision = previous?.revision ?? null;
    if (actualRevision !== input.expectedRevision) {
      throw new RevisionConflictError(input.scopeId, input.expectedRevision, actualRevision);
    }
    for (const condition of input.assertConversations ?? []) {
      const row = readRevision.get(input.scopeId, condition.sessionId) as { revision: number } | undefined;
      if ((row?.revision ?? null) !== condition.expectedRevision) {
        throw new RevisionConflictError(condition.sessionId, condition.expectedRevision, row?.revision ?? null);
      }
    }
    const changed = new Set<string>();
    for (const mutation of input.conversations ?? []) {
      conversations.commit({ ...mutation, scopeId: input.scopeId });
      changed.add(mutation.sessionId);
    }
    const currentSessionId = input.currentSessionId === undefined ? previous?.current_session_id ?? null : input.currentSessionId;
    if (currentSessionId !== null) {
      if (input.removeConversations?.some(entry => entry.sessionId === currentSessionId)) {
        throw new StorageError('invalid_argument', 'Deleting the current conversation requires clearing or switching its pointer');
      }
      if (!readRevision.get(input.scopeId, currentSessionId)) {
        throw new StorageError('invalid_argument', 'The current conversation must exist in the same scope');
      }
    }
    const revision = ctx.nextRevision('conversation-scope', input.scopeId, input.scopeId);
    // Move the pointer before deleting its former target, preserving the FK at every statement.
    putScope.run(input.scopeId, currentSessionId, revision);
    for (const removal of input.removeConversations ?? []) {
      conversations.remove(input.scopeId, removal.sessionId, removal.expectedRevision);
      changed.add(removal.sessionId);
    }
    if ((previous?.current_session_id ?? null) !== currentSessionId) {
      if (previous?.current_session_id) changed.add(previous.current_session_id);
      if (currentSessionId) changed.add(currentSessionId);
    }
    const changeCursor = ctx.change('conversation-scope', input.scopeId, input.scopeId, revision, 'updated', [...changed]);
    return { revision, changeCursor, generation: ctx.generation };
  };

  return {
    read(scopeId) {
      return ctx.guard(() => {
        validateId(scopeId, 'scope id');
        const row = readScope.get(scopeId) as ScopeRow | undefined;
        return row ? snapshot(row) : null;
      });
    },
    list(request = {}) {
      return ctx.guard(() => {
        const limit = pageLimit(request.limit);
        const rows = listScopes.all(decodeCursor(request.cursor) ?? '', limit + 1) as ScopeRow[];
        const items = rows.slice(0, limit).map(snapshot);
        return {
          items,
          ...(rows.length > limit ? { nextCursor: encodeCursor(items[items.length - 1].scopeId) } : {}),
        };
      });
    },
    commit(input) {
      return ctx.guard(() => commit(input));
    },
  };
}

export function createConversationScopeRepository(ctx: SqliteContext): ConversationScopeRepository {
  const operations = createConversationScopeOperations(ctx);
  const commit = ctx.db.transaction((input: ConversationScopeCommit) => operations.commit(input));
  return {
    async read(scopeId) { return operations.read(scopeId); },
    async list(request) { return operations.list(request); },
    async commit(input) { return ctx.guard(() => commit.immediate(input)); },
  };
}
