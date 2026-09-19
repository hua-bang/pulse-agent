import { createHash } from 'node:crypto';
import type { EntityRecord, JsonObject } from '../contracts.js';
import type {
  FileWriteInput,
  FileWriteRecord,
  FileWriteRepository,
  FileWriteResolution,
  FileWriteSettlement,
  FileWriteStatus,
} from '../file-contracts.js';
import { StorageError } from '../errors.js';
import type { SqliteContext } from './context.js';
import { decodeCursor, decodeJson, encodeCursor, encodeJson, pageLimit, validateId } from './validation.js';

export const FILE_WRITES_SCHEMA = `
  CREATE TABLE file_write_intents (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    uri TEXT NOT NULL,
    node_binding TEXT NOT NULL CHECK (json_valid(node_binding)),
    body TEXT NOT NULL CHECK (json_valid(body)),
    status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'conflict', 'error')),
    error TEXT
  ) STRICT;
  CREATE INDEX file_write_intents_pending ON file_write_intents (workspace_id, status, sequence);
`;

interface IntentRow {
  sequence: number;
  id: string;
  workspace_id: string;
  node_id: string;
  uri: string;
  node_binding: string;
  body: string;
  status: FileWriteStatus;
  error: string | null;
}

const STATUSES: FileWriteStatus[] = ['pending', 'applied', 'conflict', 'error'];

function textVersion(content: string): string {
  return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

function validateWrite(write: FileWriteInput): void {
  if (!write || typeof write !== 'object') throw new StorageError('invalid_argument', 'Invalid file write intent.');
  validateId(write.id, 'file write id');
  validateId(write.nodeId, 'file write node id');
  if (typeof write.uri !== 'string' || !write.uri) {
    throw new StorageError('invalid_argument', 'A file write requires a resource URI.');
  }
  try { new URL(write.uri); }
  catch (cause) { throw new StorageError('invalid_argument', 'Invalid file resource URI.', { cause }); }
  if (typeof write.content !== 'string' || Buffer.from(write.content, 'utf8').toString('utf8') !== write.content
    || (write.baseContent !== null && (typeof write.baseContent !== 'string'
      || Buffer.from(write.baseContent, 'utf8').toString('utf8') !== write.baseContent))) {
    throw new StorageError('invalid_argument', 'File snapshots must be UTF-8 text.');
  }
  if (write.targetVersion !== textVersion(write.content)
    || write.baseVersion !== (write.baseContent === null ? null : textVersion(write.baseContent))) {
    throw new StorageError('invalid_argument', 'File versions must match their recovery snapshots.');
  }
}

function inputBody(write: FileWriteInput): string {
  return encodeJson({
    id: write.id, nodeId: write.nodeId, uri: write.uri,
    baseVersion: write.baseVersion, targetVersion: write.targetVersion,
    baseContent: write.baseContent, content: write.content,
  });
}

function fromRow(row: IntentRow): FileWriteRecord {
  return {
    ...decodeJson<FileWriteInput>(row.body),
    workspaceId: row.workspace_id,
    status: row.status,
    ...(row.error === null ? {} : { error: row.error }),
  };
}

function nodeData(node: EntityRecord): JsonObject | undefined {
  const data = node.data;
  return data && typeof data === 'object' && !Array.isArray(data) ? data : undefined;
}

function nodeBinding(data: JsonObject): string {
  return encodeJson({ filePath: data.filePath ?? null, uri: data.uri ?? null });
}

/** Stage after node changes, inside the owning Canvas commit transaction. */
export function stageFileWrites(
  ctx: SqliteContext,
  workspaceId: string,
  writes: readonly FileWriteInput[] = [],
): string[] {
  if (!ctx.db.inTransaction) throw new StorageError('storage_unavailable', 'File write intents require a Canvas transaction.');
  validateId(workspaceId, 'workspace id');
  if (!Array.isArray(writes)) throw new StorageError('invalid_argument', 'File write intents must be an array.');
  const ids = new Set<string>();
  const nodes = new Set<string>();
  const uris = new Set<string>();
  const touched: string[] = [];
  for (const write of writes) {
    validateWrite(write);
    if (ids.has(write.id) || nodes.has(write.nodeId) || uris.has(write.uri)) {
      throw new StorageError('invalid_argument', 'A commit may contain only one intent per file and node.');
    }
    ids.add(write.id);
    nodes.add(write.nodeId);
    uris.add(write.uri);
    const body = inputBody(write);
    const previous = ctx.db.prepare('SELECT * FROM file_write_intents WHERE id = ?').get(write.id) as IntentRow | undefined;
    if (previous) {
      if (previous.workspace_id !== workspaceId || previous.body !== body) {
        throw new StorageError('invalid_argument', `File write id ${write.id} was already used by a different intent.`);
      }
      continue;
    }
    const row = ctx.db.prepare(
      "SELECT body FROM canvas_records WHERE workspace_id = ? AND collection = 'node' AND id = ?",
    ).get(workspaceId, write.nodeId) as { body: string } | undefined;
    const node = row ? decodeJson<EntityRecord>(row.body) : undefined;
    const data = node ? nodeData(node) : undefined;
    if (!node || node.type !== 'file' || !data || data.content !== write.content) {
      throw new StorageError('invalid_argument', 'A file intent must match its committed file node content.');
    }
    ctx.db.prepare(`
      INSERT INTO file_write_intents (id, workspace_id, node_id, uri, node_binding, body, status)
      VALUES (?, ?, ?, ?, ?, ?, 'pending')
    `).run(write.id, workspaceId, write.nodeId, write.uri, nodeBinding(data), body);
    const pendingNode = {
      ...node,
      data: { ...data, fileWriteIntentId: write.id, fileWriteStatus: 'pending', saved: false, modified: true },
    };
    ctx.db.prepare(
      "UPDATE canvas_records SET body = ? WHERE workspace_id = ? AND collection = 'node' AND id = ?",
    ).run(encodeJson(pendingNode), workspaceId, write.nodeId);
    touched.push(write.nodeId);
  }
  return touched;
}

export function createFileWriteRepository(ctx: SqliteContext): FileWriteRepository {
  const select = ctx.db.prepare('SELECT * FROM file_write_intents WHERE id = ?');
  const settle = ctx.db.transaction((id: string, outcome: FileWriteSettlement): FileWriteResolution => {
    validateId(id, 'file write id');
    if (!outcome || !['applied', 'conflict', 'error'].includes(outcome.status)
      || (outcome.error !== undefined && typeof outcome.error !== 'string')) {
      throw new StorageError('invalid_argument', 'Invalid file write outcome.');
    }
    const row = select.get(id) as IntentRow | undefined;
    if (!row) throw new StorageError('not_found', `File write intent ${id} was not found.`);
    if (row.status === 'applied' || (row.status === outcome.status && row.error === (outcome.error ?? null))) {
      return { record: fromRow(row) };
    }
    // A transient filesystem error must not make a conflicted write retryable.
    if (row.status === 'conflict' && outcome.status === 'error') return { record: fromRow(row) };
    const record: FileWriteRecord = {
      ...fromRow(row), status: outcome.status,
    };
    delete record.error;
    if (outcome.error !== undefined) record.error = outcome.error;
    ctx.db.prepare('UPDATE file_write_intents SET status = ?, error = ? WHERE id = ?')
      .run(outcome.status, outcome.error ?? null, id);
    const nodeRow = ctx.db.prepare(
      "SELECT body FROM canvas_records WHERE workspace_id = ? AND collection = 'node' AND id = ?",
    ).get(row.workspace_id, row.node_id) as { body: string } | undefined;
    const node = nodeRow ? decodeJson<EntityRecord>(nodeRow.body) : undefined;
    const data = node ? nodeData(node) : undefined;
    if (!node || node.type !== 'file' || !data || data.fileWriteIntentId !== id || data.content !== record.content
      || nodeBinding(data) !== row.node_binding) return { record };
    const applied = outcome.status === 'applied';
    if (data.fileWriteStatus === outcome.status && data.saved === applied && data.modified === !applied) {
      return { record };
    }
    const body = encodeJson({
      ...node,
      data: { ...data, fileWriteStatus: outcome.status, saved: applied, modified: !applied },
    });
    ctx.db.prepare(
      "UPDATE canvas_records SET body = ? WHERE workspace_id = ? AND collection = 'node' AND id = ?",
    ).run(body, row.workspace_id, row.node_id);
    const revision = ctx.nextRevision('canvas', row.workspace_id, row.workspace_id);
    ctx.db.prepare('UPDATE workspaces SET revision = ? WHERE id = ?').run(revision, row.workspace_id);
    const changeCursor = ctx.change('canvas', row.workspace_id, row.workspace_id, revision, 'updated', [row.node_id]);
    return { record, canvasCommit: { generation: ctx.generation, revision, changeCursor } };
  });

  return {
    async get(id) {
      return ctx.guard(() => {
        validateId(id, 'file write id');
        const row = select.get(id) as IntentRow | undefined;
        return row ? fromRow(row) : null;
      });
    },
    async list(request = {}) {
      return ctx.guard(() => {
        const limit = pageLimit(request.limit);
        const cursor = decodeCursor(request.cursor) ?? '0';
        if (!/^(0|[1-9][0-9]*)$/.test(cursor) || !Number.isSafeInteger(Number(cursor))) {
          throw new StorageError('invalid_argument', 'Invalid file write cursor.');
        }
        const conditions = ['sequence > ?'];
        const parameters: Array<string | number> = [Number(cursor)];
        if (request.workspaceId !== undefined) {
          validateId(request.workspaceId, 'workspace id');
          conditions.push('workspace_id = ?');
          parameters.push(request.workspaceId);
        }
        if (request.statuses !== undefined) {
          if (!Array.isArray(request.statuses) || request.statuses.some(status => !STATUSES.includes(status))) {
            throw new StorageError('invalid_argument', 'Invalid file write status filter.');
          }
          if (!request.statuses.length) return { items: [] };
          conditions.push(`status IN (${request.statuses.map(() => '?').join(', ')})`);
          parameters.push(...request.statuses);
        }
        parameters.push(limit + 1);
        const rows = ctx.db.prepare(`
          SELECT * FROM file_write_intents WHERE ${conditions.join(' AND ')} ORDER BY sequence LIMIT ?
        `).all(...parameters) as IntentRow[];
        const visible = rows.slice(0, limit);
        return {
          items: visible.map(fromRow),
          ...(rows.length > limit ? { nextCursor: encodeCursor(String(visible[visible.length - 1].sequence)) } : {}),
        };
      });
    },
    async settle(id, outcome) {
      return ctx.guard(() => settle.immediate(id, outcome));
    },
  };
}
