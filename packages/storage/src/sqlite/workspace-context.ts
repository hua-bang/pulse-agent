import type { WorkspaceContextCommit, WorkspaceContextRepository, WorkspaceContextSnapshot } from '../workspace-context.js';
import type { CommitReceipt } from '../contracts.js';
import { RevisionConflictError, StorageError } from '../errors.js';
import type { SqliteContext } from './context.js';
import { validateId } from './validation.js';
import { createWorkspaceVisibility } from './workspace-visibility.js';

export const WORKSPACE_CONTEXT_SCHEMA = `
  CREATE TABLE workspace_context (
    workspace_id TEXT PRIMARY KEY NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL CHECK (revision > 0),
    content TEXT NOT NULL
  ) STRICT;
`;

/** One document per workspace; large enough for notes, small enough for every prompt. */
export const WORKSPACE_CONTEXT_MAX_CHARS = 200_000;

interface ContextRow { revision: number; content: string }

export type WorkspaceContextOperations = {
  read(workspaceId: string): WorkspaceContextSnapshot | null;
  commit(input: WorkspaceContextCommit): CommitReceipt;
  /** Inside a bundle transition: invalidate pre-transition revisions without touching content. */
  advance(workspaceId: string, kind: 'updated' | 'removed'): void;
};

export function createWorkspaceContextOperations(ctx: SqliteContext): WorkspaceContextOperations {
  const visibility = createWorkspaceVisibility(ctx);
  const readRow = ctx.db.prepare('SELECT revision, content FROM workspace_context WHERE workspace_id = ?');
  const workspaceExists = ctx.db.prepare('SELECT 1 FROM workspaces WHERE id = ?');
  const putRow = ctx.db.prepare(`
    INSERT INTO workspace_context (workspace_id, revision, content) VALUES (?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET revision = excluded.revision, content = excluded.content
  `);
  const setRevision = ctx.db.prepare('UPDATE workspace_context SET revision = ? WHERE workspace_id = ?');

  return {
    read(workspaceId) {
      validateId(workspaceId, 'workspace id');
      if (visibility.isTrashed(workspaceId)) return null;
      const row = readRow.get(workspaceId) as ContextRow | undefined;
      return row ? { generation: ctx.generation, workspaceId, revision: row.revision, content: row.content } : null;
    },
    commit(input) {
      if (!ctx.db.inTransaction) throw new StorageError('storage_unavailable', 'Workspace context writes require a transaction');
      if (!input || typeof input !== 'object') throw new StorageError('invalid_argument', 'Invalid workspace context commit');
      validateId(input.workspaceId, 'workspace id');
      if (input.expectedGeneration !== undefined && input.expectedGeneration !== ctx.generation) {
        throw new StorageError('revision_conflict', 'Workspace context belongs to a different storage generation');
      }
      if (input.expectedRevision !== null
        && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1)) {
        throw new StorageError('invalid_argument', 'Expected revision must be null or a positive safe integer');
      }
      if (typeof input.content !== 'string' || input.content.length > WORKSPACE_CONTEXT_MAX_CHARS) {
        throw new StorageError('invalid_argument', `Workspace context must be a string of at most ${WORKSPACE_CONTEXT_MAX_CHARS} characters`);
      }
      visibility.assertWritable(input.workspaceId);
      if (!workspaceExists.get(input.workspaceId)) {
        throw new StorageError('not_found', 'Workspace is not registered in storage');
      }
      const actual = (readRow.get(input.workspaceId) as ContextRow | undefined)?.revision ?? null;
      if (actual !== input.expectedRevision) {
        throw new RevisionConflictError(input.workspaceId, input.expectedRevision, actual);
      }
      const revision = ctx.nextRevision('workspace-context', input.workspaceId, input.workspaceId);
      putRow.run(input.workspaceId, revision, input.content);
      const changeCursor = ctx.change('workspace-context', input.workspaceId, input.workspaceId, revision, 'updated', []);
      return { generation: ctx.generation, revision, changeCursor };
    },
    advance(workspaceId, kind) {
      if (!readRow.get(workspaceId)) return;
      const revision = ctx.nextRevision('workspace-context', workspaceId, workspaceId);
      setRevision.run(revision, workspaceId);
      ctx.change('workspace-context', workspaceId, workspaceId, revision, kind, []);
    },
  };
}

export function createWorkspaceContextRepository(ctx: SqliteContext): WorkspaceContextRepository {
  const operations = createWorkspaceContextOperations(ctx);
  const commit = ctx.db.transaction((input: WorkspaceContextCommit) => operations.commit(input));
  return {
    async read(workspaceId) { return ctx.guard(() => operations.read(workspaceId)); },
    async commit(input) { return ctx.guard(() => commit.immediate(input)); },
  };
}
