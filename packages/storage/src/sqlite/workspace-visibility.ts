import { StorageError } from '../errors.js';
import type { SqliteContext } from './context.js';

/** Standalone conversation scopes remain valid unless their workspace is explicitly trashed. */
export function createWorkspaceVisibility(ctx: SqliteContext) {
  const deleted = ctx.db.prepare('SELECT 1 FROM workspace_trash WHERE workspace_id = ?');
  return {
    isTrashed(workspaceId: string): boolean { return !!deleted.get(workspaceId); },
    assertWritable(workspaceId: string): void {
      if (deleted.get(workspaceId)) {
        throw new StorageError('not_found', 'Workspace is in the trash; restore it before writing.');
      }
    },
  };
}
