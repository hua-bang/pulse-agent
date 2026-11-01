import type { JsonObject } from '../contracts.js';
import { RevisionConflictError, StorageError } from '../errors.js';
import type { WorkspaceManifestCommit, WorkspaceManifestRepository } from '../workspace-manifest.js';
import type { SqliteContext } from './context.js';
import { decodeJson, encodeJson, validateId } from './validation.js';

export const WORKSPACE_MANIFEST_SCHEMA = `
  CREATE TABLE workspace_manifest (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    revision INTEGER NOT NULL CHECK (revision > 0),
    body TEXT NOT NULL CHECK (json_valid(body))
  ) STRICT;
`;

/** Revision and change-log key of the singleton document. */
const SCOPE = 'local';
const RESOURCE = 'workspace-manifest';

interface ManifestRow {
  revision: number;
  body: string;
}

const isObject = (value: unknown): value is JsonObject => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

/** Entry ids keyed to their encoded entry, from both known list keys. */
function entries(manifest: JsonObject): Map<string, string> {
  const result = new Map<string, string>();
  for (const key of ['workspaces', 'entries']) {
    const list = manifest[key];
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (isObject(item) && typeof item.id === 'string' && !result.has(item.id)) result.set(item.id, encodeJson(item));
    }
  }
  return result;
}

/** Ids whose entry was added, removed, or changed; order-only changes report no ids. */
function changedIds(previous: JsonObject | null, next: JsonObject): string[] {
  const before = previous ? entries(previous) : new Map<string, string>();
  const after = entries(next);
  const ids = new Set<string>();
  for (const [id, body] of after) if (before.get(id) !== body) ids.add(id);
  for (const id of before.keys()) if (!after.has(id)) ids.add(id);
  return [...ids];
}

function validateInput(input: WorkspaceManifestCommit): string {
  if (!input || typeof input !== 'object') throw new StorageError('invalid_argument', 'Manifest commit must be an object');
  const revision = input.expectedRevision;
  if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) {
    throw new StorageError('invalid_argument', 'Expected revision must be null or a positive safe integer');
  }
  if (input.expectedGeneration !== undefined) validateId(input.expectedGeneration, 'storage generation');
  if (!isObject(input.manifest)) throw new StorageError('invalid_argument', 'Workspace manifest must be an object');
  return encodeJson(input.manifest);
}

export function createWorkspaceManifestRepository(ctx: SqliteContext): WorkspaceManifestRepository {
  const select = ctx.db.prepare('SELECT revision, body FROM workspace_manifest WHERE singleton = 1');
  const put = ctx.db.prepare(`
    INSERT INTO workspace_manifest (singleton, revision, body) VALUES (1, ?, ?)
    ON CONFLICT(singleton) DO UPDATE SET revision = excluded.revision, body = excluded.body
  `);
  const commit = ctx.db.transaction((input: WorkspaceManifestCommit, body: string) => {
    if (input.expectedGeneration !== undefined && input.expectedGeneration !== ctx.generation) {
      throw new StorageError('revision_conflict', 'Workspace manifest belongs to a different storage generation');
    }
    const previous = select.get() as ManifestRow | undefined;
    const actual = previous?.revision ?? null;
    if (actual !== input.expectedRevision) throw new RevisionConflictError(RESOURCE, input.expectedRevision, actual);
    const revision = ctx.nextRevision('workspace-manifest', SCOPE, RESOURCE);
    put.run(revision, body);
    const ids = changedIds(previous ? decodeJson<JsonObject>(previous.body) : null, input.manifest);
    const changeCursor = ctx.change('workspace-manifest', SCOPE, RESOURCE, revision, 'updated', ids);
    return { generation: ctx.generation, revision, changeCursor };
  });
  return {
    async read() {
      return ctx.guard(() => {
        const row = select.get() as ManifestRow | undefined;
        if (!row) return null;
        const manifest = decodeJson<unknown>(row.body);
        if (!isObject(manifest)) throw new StorageError('corrupt_data', 'Stored workspace manifest is not an object');
        return { generation: ctx.generation, revision: row.revision, manifest };
      });
    },
    async commit(input) {
      return ctx.guard(() => {
        const body = validateInput(input);
        return commit.immediate(input, body);
      });
    },
  };
}
