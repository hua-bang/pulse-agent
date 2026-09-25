import type { ChangeRepository, StorageChange } from '../contracts.js';
import type { SqliteContext } from './context.js';
import { StorageError } from '../errors.js';
import { decodeCursor, decodeJson, encodeCursor, pageLimit } from './validation.js';

interface ChangeRow {
  sequence: number;
  domain: StorageChange['domain'];
  scope_id: string;
  resource_id: string;
  revision: number;
  kind: StorageChange['kind'];
  changed_ids: string;
}

export function createChangeRepository(ctx: SqliteContext): ChangeRepository {
  return {
    async read(request = {}) {
      return ctx.guard(() => {
        const limit = pageLimit(request.limit);
        const after = decodeCursor(request.cursor) ?? '0';
        if (!/^(0|[1-9][0-9]*)$/.test(after) || !Number.isSafeInteger(Number(after))) {
          throw new StorageError('invalid_argument', 'Invalid change cursor');
        }
        const readPage = ctx.db.transaction(() => {
          if (request.cursor !== undefined) {
            const oldest = ctx.db.prepare('SELECT MIN(sequence) AS value FROM storage_changes').get() as { value: number | null };
            if (oldest.value !== null && Number(after) < oldest.value - 1) {
              throw new StorageError('revision_conflict', 'Change cursor predates the retained change log; resynchronize from the latest cursor');
            }
          }
          return ctx.db.prepare(
            'SELECT * FROM storage_changes WHERE sequence > ? ORDER BY sequence LIMIT ?',
          ).all(Number(after), limit + 1) as ChangeRow[];
        });
        const rows = readPage.deferred();
        const items = rows.slice(0, limit).map(row => ({
          cursor: encodeCursor(String(row.sequence)),
          domain: row.domain,
          scopeId: row.scope_id,
          resourceId: row.resource_id,
          revision: row.revision,
          kind: row.kind,
          changedIds: decodeJson<string[]>(row.changed_ids),
        }));
        return {
          items,
          ...(rows.length > limit ? { nextCursor: items[items.length - 1].cursor } : {}),
        };
      });
    },
    async latestCursor() {
      return ctx.guard(() => {
        const row = ctx.db.prepare('SELECT COALESCE(MAX(sequence), 0) AS value FROM storage_changes').get() as { value: number };
        return encodeCursor(String(row.value));
      });
    },
  };
}
