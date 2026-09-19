import type {
  CommitReceipt,
  ConversationCommit,
  ConversationRepository,
  ConversationSnapshot,
  EntityRecord,
  JsonObject,
  Page,
  PageRequest,
} from '../contracts.js';
import { RevisionConflictError, StorageError } from '../errors.js';
import type { SqliteContext } from './context.js';
import { decodeCursor, decodeJson, encodeCursor, encodeJson, pageLimit, validateId } from './validation.js';
import { createWorkspaceVisibility } from './workspace-visibility.js';

interface ConversationRow {
  scope_id: string;
  session_id: string;
  revision: number;
  metadata: string;
}

interface MessageRow {
  id: string;
  body: string;
}

interface EncodedMessage {
  id: string;
  body: string;
}

function validateRevision(revision: number | null, allowCreate: boolean): void {
  if (revision === null && allowCreate) return;
  if (revision === null || !Number.isSafeInteger(revision) || revision < 1) {
    const expected = allowCreate ? 'null or a positive safe integer' : 'a positive safe integer';
    throw new StorageError('invalid_argument', `expectedRevision must be ${expected}`);
  }
}

function encodeMessages(messages: readonly EntityRecord[] | undefined): EncodedMessage[] {
  if (messages === undefined) return [];
  if (!Array.isArray(messages)) {
    throw new StorageError('invalid_argument', 'Messages must be an array');
  }
  return messages.map(message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      throw new StorageError('invalid_argument', 'Each message must be an object');
    }
    validateId(message.id, 'message id');
    return { id: message.id, body: encodeJson(message) };
  });
}

function metadataFromRow(row: ConversationRow, generation: string): Omit<ConversationSnapshot, 'messages'> {
  return {
    generation,
    scopeId: row.scope_id,
    sessionId: row.session_id,
    revision: row.revision,
    metadata: decodeJson<JsonObject>(row.metadata),
  };
}

/** Synchronous adapter operations; mutations require an existing database transaction. */
export interface ConversationOperations {
  read(scopeId: string, sessionId: string): ConversationSnapshot | null;
  list(scopeId: string, request?: PageRequest): Page<Omit<ConversationSnapshot, 'messages'>>;
  commit(input: ConversationCommit): CommitReceipt;
  remove(scopeId: string, sessionId: string, expectedRevision: number): CommitReceipt;
}

export function createConversationOperations(ctx: SqliteContext): ConversationOperations {
  const { db } = ctx;
  const visibility = createWorkspaceVisibility(ctx);
  const findConversation = db.prepare(`
    SELECT scope_id, session_id, revision, metadata FROM conversations
    WHERE scope_id = ? AND session_id = ?
  `);
  const findMessages = db.prepare(`
    SELECT id, body FROM conversation_messages
    WHERE scope_id = ? AND session_id = ? ORDER BY position
  `);
  const findMessageIds = db.prepare(`
    SELECT id FROM conversation_messages
    WHERE scope_id = ? AND session_id = ? ORDER BY position
  `);
  const findMessage = db.prepare(`
    SELECT id FROM conversation_messages WHERE scope_id = ? AND session_id = ? AND id = ?
  `);
  const findLastPosition = db.prepare(`
    SELECT MAX(position) AS position FROM conversation_messages WHERE scope_id = ? AND session_id = ?
  `);
  const insertConversation = db.prepare(`
    INSERT INTO conversations (scope_id, session_id, revision, metadata) VALUES (?, ?, ?, ?)
  `);
  const updateConversation = db.prepare(`
    UPDATE conversations SET revision = ?, metadata = ? WHERE scope_id = ? AND session_id = ?
  `);
  const insertMessage = db.prepare(`
    INSERT INTO conversation_messages (scope_id, session_id, id, position, body) VALUES (?, ?, ?, ?, ?)
  `);
  const deleteMessages = db.prepare('DELETE FROM conversation_messages WHERE scope_id = ? AND session_id = ?');
  const deleteConversation = db.prepare('DELETE FROM conversations WHERE scope_id = ? AND session_id = ?');
  const listConversations = db.prepare(`
    SELECT scope_id, session_id, revision, metadata FROM conversations
    WHERE scope_id = ? AND (? IS NULL OR session_id > ?)
      AND NOT EXISTS (SELECT 1 FROM workspace_trash WHERE workspace_id = conversations.scope_id)
    ORDER BY session_id LIMIT ?
  `);

  const readTransaction = db.transaction((scopeId: string, sessionId: string): ConversationSnapshot | null => {
    if (visibility.isTrashed(scopeId)) return null;
    const row = findConversation.get(scopeId, sessionId) as ConversationRow | undefined;
    if (!row) return null;
    const messages = findMessages.all(scopeId, sessionId) as MessageRow[];
    return {
      ...metadataFromRow(row, ctx.generation),
      messages: messages.map(message => decodeJson<EntityRecord>(message.body)),
    };
  });

  const commitMutation = (
    input: ConversationCommit,
    messages: EncodedMessage[],
    metadata: string | undefined,
  ) => {
    const { scopeId, sessionId, expectedRevision } = input;
    visibility.assertWritable(scopeId);
    if (input.expectedGeneration !== undefined && input.expectedGeneration !== ctx.generation) {
      throw new StorageError('revision_conflict', 'Conversation belongs to a different storage generation');
    }
    const current = findConversation.get(scopeId, sessionId) as ConversationRow | undefined;
    const actualRevision = current?.revision ?? null;
    if (actualRevision !== expectedRevision) {
      throw new RevisionConflictError(sessionId, expectedRevision, actualRevision);
    }

    const revision = ctx.nextRevision('conversation', scopeId, sessionId);
    const nextMetadata = metadata ?? current?.metadata ?? encodeJson({});
    if (current) {
      updateConversation.run(revision, nextMetadata, scopeId, sessionId);
    } else {
      insertConversation.run(scopeId, sessionId, revision, nextMetadata);
    }

    const changedIds = new Set<string>();
    if (input.replaceMessages !== undefined) {
      for (const row of findMessageIds.all(scopeId, sessionId) as Array<{ id: string }>) changedIds.add(row.id);
      deleteMessages.run(scopeId, sessionId);
    }
    const last = findLastPosition.get(scopeId, sessionId) as { position: number | null };
    let position = (last.position ?? -1) + 1;
    for (const message of messages) {
      if (findMessage.get(scopeId, sessionId, message.id)) {
        throw new StorageError('invalid_argument', `Duplicate message id: ${message.id}`);
      }
      insertMessage.run(scopeId, sessionId, message.id, position, message.body);
      position += 1;
      changedIds.add(message.id);
    }

    const changeCursor = ctx.change('conversation', scopeId, sessionId, revision, 'updated', [...changedIds]);
    return { revision, changeCursor, generation: ctx.generation };
  };

  const removeMutation = (scopeId: string, sessionId: string, expectedRevision: number) => {
    visibility.assertWritable(scopeId);
    const current = findConversation.get(scopeId, sessionId) as ConversationRow | undefined;
    const actualRevision = current?.revision ?? null;
    if (actualRevision !== expectedRevision) {
      throw new RevisionConflictError(sessionId, expectedRevision, actualRevision);
    }
    const ids = (findMessageIds.all(scopeId, sessionId) as Array<{ id: string }>).map(message => message.id);
    deleteConversation.run(scopeId, sessionId);
    const revision = ctx.nextRevision('conversation', scopeId, sessionId);
    const changeCursor = ctx.change('conversation', scopeId, sessionId, revision, 'removed', ids);
    return { revision, changeCursor, generation: ctx.generation };
  };

  const requireTransaction = () => {
    if (!db.inTransaction) {
      throw new StorageError('storage_unavailable', 'Conversation mutations require a transaction');
    }
  };

  return {
    read(scopeId, sessionId) {
      validateId(scopeId, 'scope id');
      validateId(sessionId, 'session id');
      return readTransaction(scopeId, sessionId);
    },

    list(scopeId, request = {}) {
      validateId(scopeId, 'scope id');
      const limit = pageLimit(request.limit);
      const cursor = decodeCursor(request.cursor) ?? null;
      const rows = listConversations.all(scopeId, cursor, cursor, limit + 1) as ConversationRow[];
      const items = rows.slice(0, limit).map(row => metadataFromRow(row, ctx.generation));
      return {
        items,
        ...(rows.length > limit ? { nextCursor: encodeCursor(items[items.length - 1].sessionId) } : {}),
      };
    },

    commit(input) {
      requireTransaction();
      validateId(input.scopeId, 'scope id');
      validateId(input.sessionId, 'session id');
      validateRevision(input.expectedRevision, true);
      if (input.replaceMessages !== undefined && input.appendMessages !== undefined) {
        throw new StorageError('invalid_argument', 'replaceMessages and appendMessages cannot be combined');
      }
      if (input.metadata !== undefined && (
        input.metadata === null || typeof input.metadata !== 'object' || Array.isArray(input.metadata)
      )) {
        throw new StorageError('invalid_argument', 'metadata must be an object');
      }
      const metadata = input.metadata === undefined ? undefined : encodeJson(input.metadata);
      const messages = encodeMessages(input.replaceMessages !== undefined ? input.replaceMessages : input.appendMessages);
      return commitMutation(input, messages, metadata);
    },

    remove(scopeId, sessionId, expectedRevision) {
      requireTransaction();
      validateId(scopeId, 'scope id');
      validateId(sessionId, 'session id');
      validateRevision(expectedRevision, false);
      return removeMutation(scopeId, sessionId, expectedRevision);
    },
  };
}

export function createConversationRepository(ctx: SqliteContext): ConversationRepository {
  const operations = createConversationOperations(ctx);
  const commit = ctx.db.transaction((input: ConversationCommit) => operations.commit(input));
  const remove = ctx.db.transaction((scopeId: string, sessionId: string, revision: number) => (
    operations.remove(scopeId, sessionId, revision)
  ));
  return {
    async read(scopeId, sessionId) {
      return ctx.guard(() => operations.read(scopeId, sessionId));
    },
    async list(scopeId, request) {
      return ctx.guard(() => operations.list(scopeId, request));
    },
    async commit(input) {
      return ctx.guard(() => commit.immediate(input));
    },
    async remove(scopeId, sessionId, revision) {
      return ctx.guard(() => remove.immediate(scopeId, sessionId, revision));
    },
  };
}
