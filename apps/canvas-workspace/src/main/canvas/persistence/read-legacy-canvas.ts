import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { StorageError, type EntityRecord } from '@pulse-coder/storage';
import { prepareLegacyCanvasImport, type LegacyCanvas } from '@pulse-coder/storage/canvas';
import { getNodeFilePath, listWorkspaceNodeIds, isSafeNodeId } from '../nodes/store';
import { readJsonWithRecovery } from './atomic-json';
import { CanvasPollutionDetectedError, detectV1Pollution } from './pollution';
import type { CanvasNode, MigrationSentinel } from './schema';

const object = (value: unknown): value is Record<string, unknown> => (
  !!value && typeof value === 'object' && !Array.isArray(value)
);

export function validateLegacyCanvas(value: unknown, source: string): LegacyCanvas {
  if (!object(value)) throw new StorageError('corrupt_data', `Invalid legacy canvas: ${source}`);
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1 && value.schemaVersion !== 2) {
    throw new StorageError('unsupported_schema', `Unsupported legacy Canvas version in ${source}`);
  }
  if ((value.nodes !== undefined && !Array.isArray(value.nodes))
    || (value.edges !== undefined && !Array.isArray(value.edges))) {
    throw new StorageError('corrupt_data', `Invalid legacy Canvas records in ${source}`);
  }
  for (const node of value.nodes ?? []) {
    if (!object(node) || typeof node.id !== 'string' || !node.id) {
      throw new StorageError('corrupt_data', `Invalid node identity in ${source}`);
    }
  }
  return value as LegacyCanvas;
}

async function optionalText(path: string): Promise<string | null> {
  try { return await fs.readFile(path, 'utf8'); }
  catch (error: unknown) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function parseJson(raw: string, source: string): unknown {
  try { return JSON.parse(raw); }
  catch (cause) { throw new StorageError('corrupt_data', `Invalid JSON in ${source}`, { cause }); }
}

async function readSentinel(root: string, workspaceId: string): Promise<MigrationSentinel | null> {
  const path = join(root, workspaceId, '.migrating');
  const raw = await optionalText(path);
  if (raw === null) return null;
  const value = parseJson(raw, path);
  if (object(value) && value.schemaVersion !== undefined) {
    throw new StorageError('unsupported_schema', `Unknown migration sentinel schema in ${workspaceId}`);
  }
  if (!object(value) || value.workspaceId !== workspaceId
    || typeof value.startedAt !== 'number' || !Number.isFinite(value.startedAt) || value.startedAt < 0
    || (value.sourceUpdatedAt !== null && (typeof value.sourceUpdatedAt !== 'number' || !Number.isFinite(value.sourceUpdatedAt)))
    || !Array.isArray(value.expectedNodeIds)
    || value.expectedNodeIds.some(id => typeof id !== 'string' || !isSafeNodeId(id))
    || new Set(value.expectedNodeIds).size !== value.expectedNodeIds.length) {
    throw new StorageError('corrupt_data', `Cannot verify interrupted migration for ${workspaceId}`);
  }
  return value as unknown as MigrationSentinel;
}

function expectedPartialIds(data: LegacyCanvas, sentinel: MigrationSentinel): Set<string> {
  const nodes = data.nodes ?? [];
  const expected = nodes.map(node => node.id).filter((id): id is string => typeof id === 'string' && isSafeNodeId(id));
  const timestamps = nodes.map(node => node.updatedAt).filter((value): value is number => typeof value === 'number');
  const updated = timestamps.length ? Math.max(...timestamps) : null;
  if (!isDeepStrictEqual(expected, sentinel.expectedNodeIds) || updated !== sentinel.sourceUpdatedAt
    || nodes.some(node => !(node.type === 'reference' && node.ref) && !object(node.data))) {
    throw new StorageError('corrupt_data', `The v1 source no longer matches its migration sentinel: ${sentinel.workspaceId}`);
  }
  return new Set(nodes.filter(node => !(node.type === 'reference' && node.ref)).map(node => node.id!));
}

/** Read migration inputs only. Never invoke the legacy loader's cleanup/recovery writes. */
export async function readLegacyCanvasWorkspace(root: string, workspaceId: string) {
  const layoutPath = join(root, workspaceId, 'canvas.json');
  const primary = await optionalText(layoutPath);
  let primaryIsJson = false;
  // Reject future primary layouts before considering any older backup.
  if (primary !== null) {
    try {
      validateLegacyCanvas(JSON.parse(primary), layoutPath);
      primaryIsJson = true;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  const sentinel = await readSentinel(root, workspaceId);
  const backupPath = join(root, workspaceId, 'canvas.json.v1.bak');
  let data: LegacyCanvas | null = null;
  // An interrupted split can leave a missing or torn layout. Use only the
  // v1 backup verified against its sentinel below; never repair source files.
  if (!primaryIsJson && sentinel) {
    const backup = await optionalText(backupPath);
    if (backup === null) throw new StorageError('corrupt_data', `Missing interrupted-migration source in ${workspaceId}`);
    data = validateLegacyCanvas(parseJson(backup, backupPath), backupPath);
    if (data.schemaVersion === 2) throw new StorageError('corrupt_data', `Expected an intact v1 backup in ${workspaceId}`);
  } else {
    const source = await readJsonWithRecovery(layoutPath);
    if (source.kind === 'unrecoverable') throw source.err;
    if (source.kind === 'ok') data = validateLegacyCanvas(source.data, layoutPath);
    if (!data && !sentinel) {
      // A legacy flat layout may coexist with a directory of off-canvas atoms.
      const flatPath = join(root, `${workspaceId}.json`);
      const flat = await optionalText(flatPath);
      if (flat !== null) {
        const parsed = parseJson(flat, flatPath);
        if (object(parsed) && Array.isArray(parsed.nodes)) data = validateLegacyCanvas(parsed, flatPath);
      }
    }
  }

  const ignored = data && data.schemaVersion !== 2 && sentinel ? expectedPartialIds(data, sentinel) : new Set<string>();
  if (data && data.schemaVersion !== 2 && sentinel && primary !== null) {
    const backup = await optionalText(backupPath);
    if (backup !== null && !isDeepStrictEqual(data, validateLegacyCanvas(parseJson(backup, backupPath), backupPath))) {
      throw new StorageError('corrupt_data', `The v1 source and backup disagree in ${workspaceId}`);
    }
  }
  const atoms: EntityRecord[] = [];
  for (const id of await listWorkspaceNodeIds(workspaceId, root)) {
    const path = getNodeFilePath(workspaceId, id, root);
    let record: unknown;
    try { record = parseJson(await fs.readFile(path, 'utf8'), path); }
    catch (error) { if (ignored.has(id)) continue; throw error; }
    if (object(record) && record.schemaVersion !== undefined && record.schemaVersion !== 1) {
      throw new StorageError('unsupported_schema', `Unsupported node version in ${workspaceId}: ${id}`);
    }
    if (ignored.has(id)) continue;
    if (!object(record) || record.id !== id || typeof record.type !== 'string' || !object(record.data)) {
      throw new StorageError('corrupt_data', `Invalid node record in ${workspaceId}: ${id}`);
    }
    atoms.push(record as EntityRecord);
  }
  if (!data && atoms.length === 0) return null;
  data ??= { nodes: [], edges: [], transform: { x: 0, y: 0, scale: 1 } };
  const byId = new Map(atoms.map(atom => [atom.id, atom]));
  if (data.schemaVersion === 2) {
    data = {
      ...data,
      nodes: (data.nodes ?? []).map(node => {
        if (node.type === 'reference' && node.ref) return node;
        const atom = byId.get(node.id!);
        if (!atom) throw new StorageError('corrupt_data', `Missing node record in ${workspaceId}: ${node.id}`);
        return {
          ...node, type: atom.type as string, title: (atom.title ?? node.title) as string | undefined,
          data: atom.data as Record<string, unknown>, properties: atom.properties as Record<string, unknown> | undefined,
          links: atom.links as unknown[] | undefined, updatedAt: (atom.updatedAt ?? node.updatedAt) as number | undefined,
        };
      }),
    };
    // The projection now contains inline bodies, just like the legacy loader.
    delete data.schemaVersion;
  } else if (!sentinel) {
    const conflicts = new Set(await detectV1Pollution(workspaceId, (data.nodes ?? []) as CanvasNode[], root));
    for (const node of data.nodes ?? []) {
      const atom = byId.get(node.id!);
      if (node.type === 'reference' && node.ref || !atom) continue;
      if (['type', 'title', 'data', 'properties', 'links'].some(field => (
        node[field] !== undefined && atom[field] !== undefined && !isDeepStrictEqual(node[field], atom[field])
      ))) conflicts.add(node.id!);
    }
    if (conflicts.size) throw new CanvasPollutionDetectedError(workspaceId, [...conflicts]);
  }
  return prepareLegacyCanvasImport(workspaceId, data, atoms);
}
