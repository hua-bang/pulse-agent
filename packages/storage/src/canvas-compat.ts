import type {
  CanvasRepository,
  CanvasSnapshot,
  EntityRecord,
  JsonObject,
  JsonValue,
  RecordChanges,
} from './contracts.js';
import { RevisionConflictError, StorageError, isStorageError } from './errors.js';
import type { FileWriteInput } from './file-contracts.js';

export interface LegacyCanvasNode extends Record<string, unknown> {
  id?: string;
  type?: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  ref?: unknown;
  data?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  links?: unknown[];
  updatedAt?: number;
}

export interface LegacyCanvas extends Record<string, unknown> {
  storageGeneration?: string;
  revision?: number | null;
  nodes?: LegacyCanvasNode[];
  edges?: unknown[];
  transform?: unknown;
  savedAt?: string;
}

export interface LegacyCanvasWriteOptions {
  fileWrites?: readonly FileWriteInput[];
  removedNodeIds?: readonly string[];
  allowEmpty?: boolean;
}

export interface PreparedLegacyCanvasImport {
  workspaceId: string;
  metadata: JsonObject;
  nodes: EntityRecord[];
  placements: EntityRecord[];
  edges: EntityRecord[];
}

const ORDER_KEY = '__canvasCompatibility';
const ATOM_FIELDS = ['type', 'title', 'data', 'properties', 'links', 'updatedAt', 'createdAt'] as const;

function requireId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !value || value.length > 1024 || /[\u0000-\u001f]/.test(value)) {
    throw new StorageError('invalid_argument', 'Invalid canvas record or workspace id.');
  }
}

/** Legacy JSON omitted undefined fields, but must not silently erase invalid values. */
function jsonObject(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new StorageError('invalid_argument', 'Expected a JSON object.');
  }
  try {
    const encoded = JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'function' || typeof item === 'symbol' || typeof item === 'bigint'
        || (typeof item === 'number' && !Number.isFinite(item))) {
        throw new Error('Invalid JSON value');
      }
      return item;
    });
    const parsed: unknown = JSON.parse(encoded);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected object');
    return parsed as JsonObject;
  } catch (cause) {
    throw new StorageError('invalid_argument', 'Canvas values must be JSON-serializable.', { cause });
  }
}

function entity(value: unknown): EntityRecord {
  const record = jsonObject(value);
  requireId(record.id);
  return record as EntityRecord;
}

function records(value: unknown, label: string): EntityRecord[] {
  if (!Array.isArray(value)) throw new StorageError('invalid_argument', `${label} must be an array.`);
  const ids = new Set<string>();
  return value.map(item => {
    const record = entity(item);
    if (ids.has(record.id)) throw new StorageError('invalid_argument', `Duplicate ${label} id: ${record.id}`);
    ids.add(record.id);
    return record;
  });
}

function equalJson(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((item, index) => equalJson(item, right[index]));
  }
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}

function reference(node: EntityRecord): boolean {
  return node.type === 'reference' && node.ref != null;
}

function orderFor(metadata: JsonObject, field: 'placementIds' | 'edgeIds'): string[] {
  const value = metadata[ORDER_KEY];
  const order = value && typeof value === 'object' && !Array.isArray(value) ? value[field] : undefined;
  return Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string') : [];
}

function ordered(records: EntityRecord[], ids: readonly string[]): EntityRecord[] {
  const remaining = new Map(records.map(record => [record.id, record]));
  const result: EntityRecord[] = [];
  for (const id of ids) {
    const record = remaining.get(id);
    if (record) {
      result.push(record);
      remaining.delete(id);
    }
  }
  return [...result, ...remaining.values()];
}

function metadataWithoutOrder(metadata: JsonObject): JsonObject {
  const { [ORDER_KEY]: _order, ...rest } = metadata;
  return rest;
}

function prepare(
  workspaceId: string,
  data: LegacyCanvas,
  atoms: readonly EntityRecord[],
  existingMetadata: JsonObject = {},
  existingEdges: EntityRecord[] = [],
): PreparedLegacyCanvasImport {
  requireId(workspaceId);
  const input = jsonObject(data);
  if (Object.hasOwn(input, ORDER_KEY)) {
    throw new StorageError('invalid_argument', `${ORDER_KEY} is reserved for canvas storage.`);
  }
  const nodes = new Map(records(atoms, 'atoms').map(record => [record.id, record]));
  const incomingNodes = records(input.nodes ?? [], 'nodes');
  const placements: EntityRecord[] = [];
  for (const node of incomingNodes) {
    if (reference(node)) {
      placements.push(node);
      continue;
    }
    const atom: EntityRecord = { ...(nodes.get(node.id) ?? { id: node.id, schemaVersion: 1, data: {} }) };
    for (const field of ATOM_FIELDS) {
      if (Object.hasOwn(node, field)) atom[field] = node[field];
    }
    nodes.set(node.id, atom);
    const { data: _data, properties: _properties, links: _links, ...placement } = node;
    placements.push(placement as EntityRecord);
  }
  const edges = input.edges === undefined ? existingEdges : records(input.edges, 'edges');
  const { nodes: _nodes, edges: _edges, revision: _revision, storageGeneration: _generation, ...metadata } = input;
  return {
    workspaceId,
    metadata: {
      ...metadataWithoutOrder(existingMetadata),
      ...metadata,
      [ORDER_KEY]: { placementIds: placements.map(node => node.id), edgeIds: edges.map(edge => edge.id) },
    },
    nodes: [...nodes.values()],
    placements,
    edges,
  };
}

/** Pure import projection: all atoms survive, including knowledge outside the canvas. */
export function prepareLegacyCanvasImport(
  workspaceId: string,
  data: object,
  atoms: readonly EntityRecord[] = [],
): PreparedLegacyCanvasImport {
  return prepare(workspaceId, jsonObject(data) as LegacyCanvas, atoms);
}

export function materializeCanvasSnapshot(snapshot: CanvasSnapshot): LegacyCanvas {
  const atoms = new Map(snapshot.nodes.map(node => [node.id, node]));
  const nodes = ordered(snapshot.placements, orderFor(snapshot.metadata, 'placementIds')).map(placement => {
    if (reference(placement)) return placement;
    const atom = atoms.get(placement.id);
    const node: EntityRecord = { ...placement, data: atom?.data ?? {} };
    if (atom) {
      for (const field of ATOM_FIELDS) {
        if (Object.hasOwn(atom, field)) node[field] = atom[field];
      }
    }
    return node;
  });
  return {
    ...metadataWithoutOrder(snapshot.metadata),
    nodes,
    edges: ordered(snapshot.edges, orderFor(snapshot.metadata, 'edgeIds')),
    revision: snapshot.revision,
    storageGeneration: snapshot.generation,
  };
}

function differences(before: EntityRecord[], after: EntityRecord[], removeMissing: boolean): RecordChanges {
  const previous = new Map(before.map(record => [record.id, record]));
  const incoming = new Set(after.map(record => record.id));
  const put = after.filter(record => !equalJson(previous.get(record.id), record));
  const remove = removeMissing ? before.filter(record => !incoming.has(record.id)).map(record => record.id) : [];
  return { ...(put.length ? { put } : {}), ...(remove.length ? { remove } : {}) };
}

function isConflict(error: unknown): boolean {
  return isStorageError(error) && error.code === 'revision_conflict';
}

export function createCanvasCompatibilityStore(repository: CanvasRepository) {
  return {
    async readCanvas(workspaceId: string): Promise<LegacyCanvas | null> {
      const snapshot = await repository.read(workspaceId);
      return snapshot ? materializeCanvasSnapshot(snapshot) : null;
    },
    async writeCanvas(
      workspaceId: string,
      data: object,
      options: LegacyCanvasWriteOptions = {},
    ): Promise<{ revision: number; storageGeneration: string }> {
      const input = jsonObject(data) as LegacyCanvas;
      const snapshot = await repository.read(workspaceId);
      const expectedRevision = input.revision ?? null;
      const actualRevision = snapshot?.revision ?? null;
      if (expectedRevision !== actualRevision) {
        throw new RevisionConflictError(workspaceId, expectedRevision, actualRevision);
      }
      if (snapshot && input.storageGeneration !== snapshot.generation) {
        throw new StorageError('revision_conflict', 'Canvas snapshot belongs to a different storage generation');
      }
      const prepared = prepare(workspaceId, input, snapshot?.nodes ?? [], snapshot?.metadata,
        snapshot ? ordered(snapshot.edges, orderFor(snapshot.metadata, 'edgeIds')) : []);
      if (!options.allowEmpty && snapshot?.placements.length && !prepared.placements.length) {
        throw new StorageError('invalid_argument', 'Refusing an empty canvas overwrite; pass allowEmpty for an intentional clear.');
      }
      const removed = options.removedNodeIds ?? [];
      const removedIds = new Set<string>();
      for (const id of removed) {
        requireId(id);
        if (removedIds.has(id)) throw new StorageError('invalid_argument', `Duplicate removed node id: ${id}`);
        removedIds.add(id);
        if (prepared.placements.some(node => node.id === id && !reference(node))) {
          throw new StorageError('invalid_argument', `Cannot write and remove the same node: ${id}`);
        }
      }
      const nodeChanges = differences(snapshot?.nodes ?? [], prepared.nodes.filter(node => !removedIds.has(node.id)), false);
      const receipt = await repository.commit({
        workspaceId,
        expectedRevision,
        expectedGeneration: input.storageGeneration,
        fileWrites: options.fileWrites,
        ...(equalJson(snapshot?.metadata, prepared.metadata) ? {} : { metadata: prepared.metadata }),
        nodes: { ...nodeChanges, ...(removed.length ? { remove: removed } : {}) },
        placements: differences(snapshot?.placements ?? [], prepared.placements, true),
        edges: differences(snapshot?.edges ?? [], prepared.edges, true),
      });
      const mutable = data as LegacyCanvas;
      mutable.revision = receipt.revision;
      mutable.storageGeneration = receipt.generation;
      return { revision: receipt.revision, storageGeneration: receipt.generation };
    },
    readNode(workspaceId: string, nodeId: string): Promise<EntityRecord | null> {
      return repository.readNode(workspaceId, nodeId);
    },
    async listNodes(workspaceId: string): Promise<EntityRecord[]> {
      const result: EntityRecord[] = [];
      let cursor: string | undefined;
      do {
        const page = await repository.listNodes(workspaceId, { cursor, limit: 500 });
        result.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      return result;
    },
    /** The callback is pure and may run again after a conflict; no transaction spans its await. */
    async mutateNode<T>(
      workspaceId: string,
      nodeId: string,
      fn: (record: EntityRecord | null) => { record?: EntityRecord; result: T }
        | Promise<{ record?: EntityRecord; result: T }>,
    ): Promise<T> {
      requireId(nodeId);
      for (let attempt = 0; ; attempt += 1) {
        const snapshot = await repository.read(workspaceId);
        const current = snapshot?.nodes.find(node => node.id === nodeId);
        const mutation = await fn(current ? entity(current) : null);
        if (!mutation.record) return mutation.result;
        const record = entity(mutation.record);
        if (record.id !== nodeId) throw new StorageError('invalid_argument', 'A node mutation cannot change its id.');
        try {
          await repository.commit({
            workspaceId, expectedRevision: snapshot?.revision ?? null,
            expectedGeneration: snapshot?.generation,
            ...(snapshot ? {} : { metadata: {} }),
            nodes: equalJson(current, record) ? {} : { put: [record] },
          });
          return mutation.result;
        } catch (error) {
          if (!isConflict(error) || attempt >= 2) throw error;
        }
      }
    },
    async deleteNode(workspaceId: string, nodeId: string): Promise<void> {
      requireId(nodeId);
      for (let attempt = 0; ; attempt += 1) {
        const snapshot = await repository.read(workspaceId);
        if (!snapshot?.nodes.some(node => node.id === nodeId)) return;
        try {
          await repository.commit({ workspaceId, expectedRevision: snapshot.revision, nodes: { remove: [nodeId] } });
          return;
        } catch (error) {
          if (!isConflict(error) || attempt >= 2) throw error;
        }
      }
    },
  };
}
