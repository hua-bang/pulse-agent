import type { WorkspaceBundle, WorkspaceBundleImport, WorkspaceConversationState, WorkspaceRepository, WorkspaceTrashRecord, TrashWorkspaceInput } from '../workspace-contracts.js';
import type { JsonObject, PageRequest } from '../contracts.js';
import { RevisionConflictError, StorageError } from '../errors.js';
import type { SqliteContext } from './context.js';
import { createCanvasOperations } from './canvas.js';
import { createConversationOperations } from './conversations.js';
import { createConversationScopeOperations } from './conversation-scopes.js';
import { decodeCursor, decodeJson, encodeCursor, encodeJson, pageLimit, validateId } from './validation.js';
import { createWorkspaceVisibility } from './workspace-visibility.js';

interface SessionRevision { session_id: string; revision: number }
interface TrashRow { workspace_id: string; revision: number; deleted_at: string; metadata: string }

export function createWorkspaceRepository(ctx: SqliteContext): WorkspaceRepository {
  const canvas = createCanvasOperations(ctx);
  const conversations = createConversationOperations(ctx);
  const scopes = createConversationScopeOperations(ctx);
  const visibility = createWorkspaceVisibility(ctx);
  const workspaceRevision = ctx.db.prepare('SELECT revision FROM workspaces WHERE id = ?');
  const sessionRevisions = ctx.db.prepare('SELECT session_id, revision FROM conversations WHERE scope_id = ? ORDER BY session_id');
  const clearPointer = ctx.db.prepare('UPDATE conversation_scopes SET current_session_id = NULL WHERE scope_id = ?');
  const deleteScope = ctx.db.prepare('DELETE FROM conversation_scopes WHERE scope_id = ?');
  const trashed = ctx.db.prepare(`
    SELECT t.workspace_id, w.revision, t.deleted_at, t.metadata
    FROM workspace_trash t JOIN workspaces w ON w.id = t.workspace_id WHERE t.workspace_id = ?
  `);
  const trashedPage = ctx.db.prepare(`
    SELECT t.workspace_id, w.revision, t.deleted_at, t.metadata
    FROM workspace_trash t JOIN workspaces w ON w.id = t.workspace_id
    WHERE t.workspace_id > ? ORDER BY t.workspace_id LIMIT ?
  `);
  const trashRecord = (row: TrashRow): WorkspaceTrashRecord => ({
    workspaceId: row.workspace_id, revision: row.revision, generation: ctx.generation,
    deletedAt: row.deleted_at, metadata: decodeJson<JsonObject>(row.metadata),
  });

  function validateCondition(workspaceId: string, revision: number, generation: string): void {
    validateId(workspaceId, 'workspace id');
    validateId(generation, 'generation');
    if (generation !== ctx.generation) throw new StorageError('revision_conflict', 'Workspace belongs to a different storage generation');
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new StorageError('invalid_argument', 'Expected workspace revision must be a positive safe integer');
    }
  }

  /** Keep payloads and pointers intact while invalidating every pre-transition snapshot. */
  function advanceBundle(workspaceId: string, kind: 'updated' | 'removed') {
    const sessions = sessionRevisions.all(workspaceId) as SessionRevision[];
    for (const session of sessions) {
      const revision = ctx.nextRevision('conversation', workspaceId, session.session_id);
      ctx.db.prepare('UPDATE conversations SET revision = ? WHERE scope_id = ? AND session_id = ?')
        .run(revision, workspaceId, session.session_id);
      const ids = ctx.db.prepare('SELECT id FROM conversation_messages WHERE scope_id = ? AND session_id = ?')
        .all(workspaceId, session.session_id) as Array<{ id: string }>;
      ctx.change('conversation', workspaceId, session.session_id, revision, kind, ids.map(row => row.id));
    }
    if (ctx.db.prepare('SELECT 1 FROM conversation_scopes WHERE scope_id = ?').get(workspaceId)) {
      const revision = ctx.nextRevision('conversation-scope', workspaceId, workspaceId);
      ctx.db.prepare('UPDATE conversation_scopes SET revision = ? WHERE scope_id = ?').run(revision, workspaceId);
      ctx.change('conversation-scope', workspaceId, workspaceId, revision, kind, sessions.map(session => session.session_id));
    }
    const revision = ctx.nextRevision('canvas', workspaceId, workspaceId);
    ctx.db.prepare('UPDATE workspaces SET revision = ? WHERE id = ?').run(revision, workspaceId);
    const ids = ctx.db.prepare('SELECT id FROM canvas_records WHERE workspace_id = ?').all(workspaceId) as Array<{ id: string }>;
    const changeCursor = ctx.change('canvas', workspaceId, workspaceId, revision, kind, ids.map(row => row.id));
    return { revision, generation: ctx.generation, changeCursor };
  }

  function state(workspaceId: string): WorkspaceConversationState {
    const scope = scopes.read(workspaceId);
    return {
      scope: scope ? { revision: scope.revision, generation: scope.generation } : null,
      sessions: (sessionRevisions.all(workspaceId) as SessionRevision[]).map(row => ({
        sessionId: row.session_id, revision: row.revision, generation: ctx.generation,
      })),
    };
  }

  function assertConversationState(workspaceId: string, expected: WorkspaceConversationState): void {
    if (!expected || !Array.isArray(expected.sessions) || (expected.scope !== null && (
      !expected.scope || !Number.isSafeInteger(expected.scope.revision) || expected.scope.revision < 1
      || typeof expected.scope.generation !== 'string'
    ))) throw new StorageError('invalid_argument', 'Invalid workspace conversation condition');
    const ids = new Set<string>();
    for (const session of expected.sessions) {
      validateId(session.sessionId, 'session id');
      validateId(session.generation, 'generation');
      if (!Number.isSafeInteger(session.revision) || session.revision < 1 || ids.has(session.sessionId)) {
        throw new StorageError('invalid_argument', 'Invalid or duplicate conversation condition');
      }
      ids.add(session.sessionId);
    }
    const actual = state(workspaceId);
    const matchesScope = expected.scope === null ? actual.scope === null : (
      actual.scope?.revision === expected.scope.revision && actual.scope.generation === expected.scope.generation
    );
    const revisions = new Map(actual.sessions.map(session => [session.sessionId, session]));
    if (!matchesScope || actual.sessions.length !== expected.sessions.length || expected.sessions.some(session => {
      const current = revisions.get(session.sessionId);
      return current?.revision !== session.revision || current.generation !== session.generation;
    })) throw new StorageError('revision_conflict', 'Workspace conversations changed; read the workspace again before deleting');
  }

  const read = ctx.db.transaction((workspaceId: string): WorkspaceBundle | null => {
    validateId(workspaceId, 'workspace id');
    const snapshot = canvas.read(workspaceId);
    if (!snapshot) return null;
    const conversationState = state(workspaceId);
    return {
      canvas: snapshot,
      conversationScope: scopes.read(workspaceId),
      conversations: conversationState.sessions.map(session => conversations.read(workspaceId, session.sessionId)!),
      conversationState,
    };
  });

  const importBundle = ctx.db.transaction((input: WorkspaceBundleImport) => {
    const workspaceId = input.canvas.workspaceId;
    validateId(workspaceId, 'workspace id');
    if (!Array.isArray(input.canvas.nodes) || !Array.isArray(input.canvas.placements) || !Array.isArray(input.canvas.edges)) {
      throw new StorageError('invalid_argument', 'A workspace import requires complete Canvas record arrays');
    }
    if (input.expectedGeneration !== undefined && input.expectedGeneration !== ctx.generation) {
      throw new StorageError('revision_conflict', 'Workspace import belongs to a different storage generation');
    }
    if (input.conversations !== undefined && !Array.isArray(input.conversations)) {
      throw new StorageError('invalid_argument', 'Workspace conversations must be an array');
    }
    if (scopes.read(workspaceId) || sessionRevisions.get(workspaceId)) {
      throw new StorageError('revision_conflict', 'The destination workspace already has conversation history');
    }
    const receipt = canvas.commit({
      workspaceId, expectedRevision: null, expectedGeneration: input.expectedGeneration,
      metadata: input.canvas.metadata,
      nodes: { put: input.canvas.nodes }, placements: { put: input.canvas.placements }, edges: { put: input.canvas.edges },
    });
    let changeCursor = receipt.changeCursor;
    if (input.conversations !== undefined || input.currentSessionId !== undefined) {
      const scopeReceipt = scopes.commit({
        scopeId: workspaceId, expectedRevision: null, expectedGeneration: ctx.generation,
        currentSessionId: input.currentSessionId ?? null,
        conversations: (input.conversations ?? []).map(session => ({
          sessionId: session.sessionId, expectedRevision: null, expectedGeneration: ctx.generation,
          metadata: session.metadata, appendMessages: session.messages,
        })),
      });
      changeCursor = scopeReceipt.changeCursor;
    }
    return { ...receipt, changeCursor, conversationState: state(workspaceId) };
  });

  const trash = ctx.db.transaction((input: TrashWorkspaceInput): WorkspaceTrashRecord => {
    validateCondition(input.workspaceId, input.expectedCanvasRevision, input.generation);
    visibility.assertWritable(input.workspaceId);
    const row = workspaceRevision.get(input.workspaceId) as { revision: number } | undefined;
    if ((row?.revision ?? null) !== input.expectedCanvasRevision) {
      throw new RevisionConflictError(input.workspaceId, input.expectedCanvasRevision, row?.revision ?? null);
    }
    assertConversationState(input.workspaceId, input.expectedConversations);
    const metadata = input.metadata === undefined ? {} : input.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new StorageError('invalid_argument', 'Deleted workspace metadata must be an object');
    }
    const body = encodeJson(metadata);
    const deletedAt = new Date().toISOString();
    advanceBundle(input.workspaceId, 'removed');
    ctx.db.prepare('INSERT INTO workspace_trash (workspace_id, deleted_at, metadata) VALUES (?, ?, ?)')
      .run(input.workspaceId, deletedAt, body);
    return trashRecord(trashed.get(input.workspaceId) as TrashRow);
  });

  const restore = ctx.db.transaction((workspaceId: string, revision: number, generation: string) => {
    validateCondition(workspaceId, revision, generation);
    const row = trashed.get(workspaceId) as TrashRow | undefined;
    if ((row?.revision ?? null) !== revision) {
      throw new RevisionConflictError(workspaceId, revision, row?.revision ?? null);
    }
    const receipt = advanceBundle(workspaceId, 'updated');
    ctx.db.prepare('DELETE FROM workspace_trash WHERE workspace_id = ?').run(workspaceId);
    return receipt;
  });

  const remove = ctx.db.transaction((
    workspaceId: string,
    expectedCanvasRevision: number,
    generation: string,
    expectedConversations?: WorkspaceConversationState,
  ) => {
    validateId(workspaceId, 'workspace id');
    validateId(generation, 'generation');
    if (generation !== ctx.generation) throw new StorageError('revision_conflict', 'Workspace belongs to a different storage generation');
    if (!Number.isSafeInteger(expectedCanvasRevision) || expectedCanvasRevision < 1) {
      throw new StorageError('invalid_argument', 'Expected canvas revision must be a positive safe integer');
    }
    const existing = workspaceRevision.get(workspaceId) as { revision: number } | undefined;
    if ((existing?.revision ?? null) !== expectedCanvasRevision) {
      throw new RevisionConflictError(workspaceId, expectedCanvasRevision, existing?.revision ?? null);
    }
    if (expectedConversations !== undefined) assertConversationState(workspaceId, expectedConversations);
    const scope = scopes.read(workspaceId);
    const sessions = sessionRevisions.all(workspaceId) as SessionRevision[];
    if (scope) clearPointer.run(workspaceId);
    for (const session of sessions) conversations.remove(workspaceId, session.session_id, session.revision);
    if (scope) {
      deleteScope.run(workspaceId);
      const revision = ctx.nextRevision('conversation-scope', workspaceId, workspaceId);
      ctx.change('conversation-scope', workspaceId, workspaceId, revision, 'removed', sessions.map(session => session.session_id));
    }
    return canvas.remove(workspaceId, expectedCanvasRevision);
  });

  return {
    async readBundle(workspaceId) { return ctx.guard(() => read.deferred(workspaceId)); },
    async importBundle(input) { return ctx.guard(() => importBundle.immediate(input)); },
    async trashBundle(input) { return ctx.guard(() => trash.immediate(input)); },
    async getTrashed(workspaceId) {
      return ctx.guard(() => {
        validateId(workspaceId, 'workspace id');
        const row = trashed.get(workspaceId) as TrashRow | undefined;
        return row ? trashRecord(row) : null;
      });
    },
    async listTrashed(request: PageRequest = {}) {
      return ctx.guard(() => {
        const limit = pageLimit(request.limit);
        const rows = trashedPage.all(decodeCursor(request.cursor) ?? '', limit + 1) as TrashRow[];
        const items = rows.slice(0, limit).map(trashRecord);
        return {
          items,
          ...(rows.length > limit ? { nextCursor: encodeCursor(items[items.length - 1].workspaceId) } : {}),
        };
      });
    },
    async restoreBundle(workspaceId, expectedRevision, generation) {
      return ctx.guard(() => restore.immediate(workspaceId, expectedRevision, generation));
    },
    async removeBundle(workspaceId, expectedCanvasRevision, generation, expectedConversations) {
      return ctx.guard(() => remove.immediate(workspaceId, expectedCanvasRevision, generation, expectedConversations));
    },
  };
}
