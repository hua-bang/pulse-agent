import type { WorkspaceBundle, WorkspaceBundleImport, WorkspaceConversationState, WorkspaceRepository } from '../workspace-contracts.js';
import { RevisionConflictError, StorageError } from '../errors.js';
import type { SqliteContext } from './context.js';
import { createCanvasOperations } from './canvas.js';
import { createConversationOperations } from './conversations.js';
import { createConversationScopeOperations } from './conversation-scopes.js';
import { validateId } from './validation.js';

interface SessionRevision { session_id: string; revision: number }

export function createWorkspaceRepository(ctx: SqliteContext): WorkspaceRepository {
  const canvas = createCanvasOperations(ctx);
  const conversations = createConversationOperations(ctx);
  const scopes = createConversationScopeOperations(ctx);
  const workspaceRevision = ctx.db.prepare('SELECT revision FROM workspaces WHERE id = ?');
  const sessionRevisions = ctx.db.prepare('SELECT session_id, revision FROM conversations WHERE scope_id = ? ORDER BY session_id');
  const clearPointer = ctx.db.prepare('UPDATE conversation_scopes SET current_session_id = NULL WHERE scope_id = ?');
  const deleteScope = ctx.db.prepare('DELETE FROM conversation_scopes WHERE scope_id = ?');

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
    async removeBundle(workspaceId, expectedCanvasRevision, generation, expectedConversations) {
      return ctx.guard(() => remove.immediate(workspaceId, expectedCanvasRevision, generation, expectedConversations));
    },
  };
}
