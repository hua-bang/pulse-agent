import type {
  CanvasCommit,
  CanvasRepository,
  CanvasSnapshot,
  EntityRecord,
  JsonObject,
  PageRequest,
  RecordChanges,
} from '../contracts.js';
import { RevisionConflictError, StorageError } from '../errors.js';
import type { SqliteContext } from './context.js';
import { stageFileWrites } from './file-writes.js';
import { createWorkspaceVisibility } from './workspace-visibility.js';
import { decodeCursor, decodeJson, encodeCursor, encodeJson, pageLimit, validateId } from './validation.js';

type Collection = 'node' | 'placement' | 'edge';
interface WorkspaceRow { id: string; revision: number; metadata: string }
interface RecordRow { id: string; collection: Collection; body: string }
interface PreparedChanges {
  put: Array<{ id: string; body: string }>;
  remove: string[];
}

function validateRevision(revision: number | null, allowCreate = true): void {
  if ((revision === null && !allowCreate)
    || (revision !== null && (!Number.isSafeInteger(revision) || revision < 1))) {
    throw new StorageError('invalid_argument', 'Expected revision must be null or a positive safe integer.');
  }
}

function encodeMetadata(metadata: JsonObject): string {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new StorageError('invalid_argument', 'Canvas metadata must be a JSON object.');
  }
  return encodeJson(metadata);
}

function prepareChanges(changes: RecordChanges | undefined): PreparedChanges {
  if (changes === undefined) return { put: [], remove: [] };
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new StorageError('invalid_argument', 'Record changes must be an object.');
  }
  if ((changes.put !== undefined && !Array.isArray(changes.put))
    || (changes.remove !== undefined && !Array.isArray(changes.remove))) {
    throw new StorageError('invalid_argument', 'Record puts and removals must be arrays.');
  }
  const ids = new Set<string>();
  const put = (changes.put ?? []).map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new StorageError('invalid_argument', 'Each record must be a JSON object.');
    }
    validateId(record.id);
    if (ids.has(record.id)) {
      throw new StorageError('invalid_argument', `Duplicate record id: ${record.id}`);
    }
    ids.add(record.id);
    return { id: record.id, body: encodeJson(record) };
  });
  const remove = [...(changes.remove ?? [])];
  for (const id of remove) {
    validateId(id);
    if (ids.has(id)) {
      throw new StorageError('invalid_argument', `Duplicate or conflicting record id: ${id}`);
    }
    ids.add(id);
  }
  return { put, remove };
}

export type CanvasOperations = {
  [Method in keyof CanvasRepository]: (...args: Parameters<CanvasRepository[Method]>) => Awaited<ReturnType<CanvasRepository[Method]>>;
};

/** Synchronous operations reused by workspace bundles; mutations require their transaction. */
export function createCanvasOperations(ctx: SqliteContext): CanvasOperations {
  const visibility = createWorkspaceVisibility(ctx);
  const workspace = ctx.db.prepare('SELECT id, revision, metadata FROM workspaces WHERE id = ?');
  const records = ctx.db.prepare(
    'SELECT id, collection, body FROM canvas_records WHERE workspace_id = ? ORDER BY collection, id',
  );
  const oneNode = ctx.db.prepare(
    `SELECT body FROM canvas_records WHERE workspace_id = ? AND collection = 'node' AND id = ?
      AND NOT EXISTS (SELECT 1 FROM workspace_trash WHERE workspace_id = canvas_records.workspace_id)`,
  );
  const workspacePage = ctx.db.prepare(
    `SELECT id, revision, metadata FROM workspaces WHERE id > ?
      AND NOT EXISTS (SELECT 1 FROM workspace_trash WHERE workspace_id = workspaces.id) ORDER BY id LIMIT ?`,
  );
  const nodePage = ctx.db.prepare(
    `SELECT id, body FROM canvas_records WHERE workspace_id = ? AND collection = 'node' AND id > ?
      AND NOT EXISTS (SELECT 1 FROM workspace_trash WHERE workspace_id = canvas_records.workspace_id) ORDER BY id LIMIT ?`,
  );
  const createWorkspace = ctx.db.prepare('INSERT INTO workspaces (id, revision, metadata) VALUES (?, ?, ?)');
  const updateWorkspace = ctx.db.prepare('UPDATE workspaces SET revision = ?, metadata = ? WHERE id = ?');
  const putRecord = ctx.db.prepare(`
    INSERT INTO canvas_records (workspace_id, collection, id, body) VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id, collection, id) DO UPDATE SET body = excluded.body
  `);
  const removeRecord = ctx.db.prepare(
    'DELETE FROM canvas_records WHERE workspace_id = ? AND collection = ? AND id = ?',
  );
  const removeWorkspace = ctx.db.prepare('DELETE FROM workspaces WHERE id = ?');

  const readTransaction = ctx.db.transaction((workspaceId: string): CanvasSnapshot | null => {
    if (visibility.isTrashed(workspaceId)) return null;
    const row = workspace.get(workspaceId) as WorkspaceRow | undefined;
    if (!row) return null;
    const snapshot: CanvasSnapshot = {
      generation: ctx.generation,
      workspaceId,
      revision: row.revision,
      metadata: decodeJson<JsonObject>(row.metadata),
      nodes: [],
      placements: [],
      edges: [],
    };
    for (const record of records.all(workspaceId) as RecordRow[]) {
      const body = decodeJson<EntityRecord>(record.body);
      if (record.collection === 'node') snapshot.nodes.push(body);
      else if (record.collection === 'placement') snapshot.placements.push(body);
      else snapshot.edges.push(body);
    }
    return snapshot;
  });

  const commitMutation = (input: CanvasCommit) => {
    if (!ctx.db.inTransaction) throw new StorageError('storage_unavailable', 'Canvas mutations require a transaction');
    if (input.expectedGeneration !== undefined && input.expectedGeneration !== ctx.generation) {
      throw new StorageError('revision_conflict', 'Canvas snapshot belongs to a different storage generation');
    }
    validateId(input.workspaceId);
    validateRevision(input.expectedRevision);
    visibility.assertWritable(input.workspaceId);
    const row = workspace.get(input.workspaceId) as WorkspaceRow | undefined;
    const actualRevision = row?.revision ?? null;
    if (actualRevision !== input.expectedRevision) {
      throw new RevisionConflictError(input.workspaceId, input.expectedRevision, actualRevision);
    }
    const metadata = input.metadata === undefined ? row?.metadata ?? '{}' : encodeMetadata(input.metadata);
    const collections: Array<[Collection, PreparedChanges]> = [
      ['node', prepareChanges(input.nodes)],
      ['placement', prepareChanges(input.placements)],
      ['edge', prepareChanges(input.edges)],
    ];
    const revision = ctx.nextRevision('canvas', input.workspaceId, input.workspaceId);
    if (row) updateWorkspace.run(revision, metadata, input.workspaceId);
    else createWorkspace.run(input.workspaceId, revision, metadata);
    const changedIds = new Set<string>();
    for (const [collection, changes] of collections) {
      for (const record of changes.put) {
        putRecord.run(input.workspaceId, collection, record.id, record.body);
        changedIds.add(record.id);
      }
      for (const id of changes.remove) {
        removeRecord.run(input.workspaceId, collection, id);
        changedIds.add(id);
      }
    }
    for (const id of stageFileWrites(ctx, input.workspaceId, input.fileWrites)) changedIds.add(id);
    const changeCursor = ctx.change(
      'canvas', input.workspaceId, input.workspaceId, revision, 'updated', [...changedIds],
    );
    return { revision, changeCursor, generation: ctx.generation };
  };

  const removeMutation = (workspaceId: string, expectedRevision: number) => {
    if (!ctx.db.inTransaction) throw new StorageError('storage_unavailable', 'Canvas mutations require a transaction');
    validateId(workspaceId);
    validateRevision(expectedRevision, false);
    visibility.assertWritable(workspaceId);
    const row = workspace.get(workspaceId) as WorkspaceRow | undefined;
    const actualRevision = row?.revision ?? null;
    if (actualRevision !== expectedRevision) {
      throw new RevisionConflictError(workspaceId, expectedRevision, actualRevision);
    }
    const revision = ctx.nextRevision('canvas', workspaceId, workspaceId);
    const changedIds = [...new Set((records.all(workspaceId) as RecordRow[]).map(record => record.id))];
    const changeCursor = ctx.change('canvas', workspaceId, workspaceId, revision, 'removed', changedIds);
    removeWorkspace.run(workspaceId);
    return { revision, changeCursor, generation: ctx.generation };
  };

  return {
    read(workspaceId) {
      return ctx.guard(() => {
        validateId(workspaceId);
        return readTransaction.deferred(workspaceId);
      });
    },
    readNode(workspaceId, nodeId) {
      return ctx.guard(() => {
        validateId(workspaceId);
        validateId(nodeId);
        const row = oneNode.get(workspaceId, nodeId) as { body: string } | undefined;
        return row ? decodeJson<EntityRecord>(row.body) : null;
      });
    },
    list(request?: PageRequest) {
      return ctx.guard(() => {
        const limit = pageLimit(request?.limit);
        const rows = workspacePage.all(decodeCursor(request?.cursor) ?? '', limit + 1) as WorkspaceRow[];
        const visible = rows.slice(0, limit);
        return {
          items: visible.map(row => ({
            workspaceId: row.id,
            revision: row.revision,
            metadata: decodeJson<JsonObject>(row.metadata),
          })),
          ...(rows.length > limit ? { nextCursor: encodeCursor(visible[visible.length - 1].id) } : {}),
        };
      });
    },
    listNodes(workspaceId, request?: PageRequest) {
      return ctx.guard(() => {
        validateId(workspaceId);
        const limit = pageLimit(request?.limit);
        const rows = nodePage.all(workspaceId, decodeCursor(request?.cursor) ?? '', limit + 1) as RecordRow[];
        const visible = rows.slice(0, limit);
        return {
          items: visible.map(row => decodeJson<EntityRecord>(row.body)),
          ...(rows.length > limit ? { nextCursor: encodeCursor(visible[visible.length - 1].id) } : {}),
        };
      });
    },
    commit(input) {
      return ctx.guard(() => commitMutation(input));
    },
    remove(workspaceId, expectedRevision) {
      return ctx.guard(() => removeMutation(workspaceId, expectedRevision));
    },
  };
}

export function createCanvasRepository(ctx: SqliteContext): CanvasRepository {
  const operations = createCanvasOperations(ctx);
  const commit = ctx.db.transaction((input: CanvasCommit) => operations.commit(input));
  const remove = ctx.db.transaction((workspaceId: string, revision: number) => operations.remove(workspaceId, revision));
  return {
    async read(workspaceId) { return operations.read(workspaceId); },
    async readNode(workspaceId, nodeId) { return operations.readNode(workspaceId, nodeId); },
    async list(request) { return operations.list(request); },
    async listNodes(workspaceId, request) { return operations.listNodes(workspaceId, request); },
    async commit(input) { return ctx.guard(() => commit.immediate(input)); },
    async remove(workspaceId, revision) { return ctx.guard(() => remove.immediate(workspaceId, revision)); },
  };
}
