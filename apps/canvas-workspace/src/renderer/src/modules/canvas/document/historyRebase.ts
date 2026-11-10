import type { CanvasEdge, CanvasNode } from '../../../types';
import { equalDocumentValue } from './revisionMerge';

type Entity = CanvasNode | CanvasEdge;
type Fields = Record<string, unknown>;

/** `undefined` as a value means the external change removed the key. */
type FieldPatch = Array<[key: string, value: unknown]>;

interface EntityPatch {
  fields: FieldPatch;
  /** Node `data` is patched per key, so one changed key keeps the others. */
  data: FieldPatch | null;
}

export interface ExternalDelta<T extends Entity> {
  added: T[];
  removedIds: Set<string>;
  patches: Map<string, EntityPatch>;
}

const isRecord = (value: unknown): value is Fields => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

const diffFields = (before: Fields, after: Fields, skip?: string): FieldPatch => {
  const patch: FieldPatch = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === skip) continue;
    if (!equalDocumentValue(before[key], after[key])) patch.push([key, after[key]]);
  }
  return patch;
};

const applyFields = (target: Fields, patch: FieldPatch): Fields => {
  const next = { ...target };
  for (const [key, value] of patch) {
    if (value === undefined) delete next[key];
    else next[key] = value;
  }
  return next;
};

/**
 * What another writer (the Canvas Agent, the CLI) changed between two
 * published states of the document.
 */
export const diffExternalChange = <T extends Entity>(
  before: readonly T[],
  after: readonly T[],
): ExternalDelta<T> => {
  const beforeById = new Map(before.map(item => [item.id, item]));
  const afterIds = new Set(after.map(item => item.id));
  const added: T[] = [];
  const patches = new Map<string, EntityPatch>();

  for (const item of after) {
    const previous = beforeById.get(item.id);
    if (!previous) {
      added.push(item);
      continue;
    }
    if (previous === item) continue;
    const previousFields = previous as unknown as Fields;
    const itemFields = item as unknown as Fields;
    const nestedData = isRecord(previousFields.data) && isRecord(itemFields.data);
    const fields = diffFields(previousFields, itemFields, nestedData ? 'data' : undefined);
    const data = nestedData
      ? diffFields(previousFields.data as Fields, itemFields.data as Fields)
      : null;
    if (fields.length > 0 || (data && data.length > 0)) {
      patches.set(item.id, { fields, data: data && data.length > 0 ? data : null });
    }
  }

  const removedIds = new Set(before.filter(item => !afterIds.has(item.id)).map(item => item.id));
  return { added, removedIds, patches };
};

export const isEmptyDelta = (delta: ExternalDelta<Entity>): boolean => (
  delta.added.length === 0 && delta.removedIds.size === 0 && delta.patches.size === 0
);

/**
 * Apply an external change to one recorded history state. Undo and redo
 * restore whole states, so a state that does not carry the external change
 * would delete it again when it is restored.
 */
export const rebaseOnExternalChange = <T extends Entity>(
  recorded: T[],
  delta: ExternalDelta<T>,
): T[] => {
  if (isEmptyDelta(delta)) return recorded;
  const present = new Set<string>();
  const next: T[] = [];

  for (const item of recorded) {
    if (delta.removedIds.has(item.id)) continue;
    present.add(item.id);
    const patch = delta.patches.get(item.id);
    if (!patch) {
      next.push(item);
      continue;
    }
    const fields = applyFields(item as unknown as Fields, patch.fields);
    if (patch.data && isRecord(fields.data)) fields.data = applyFields(fields.data, patch.data);
    next.push(fields as unknown as T);
  }

  for (const item of delta.added) {
    if (!present.has(item.id)) next.push(item);
  }
  return next;
};

/** Edges of a recorded state that still point at nodes removed externally. */
export const dropEdgesOfRemovedNodes = (
  edges: CanvasEdge[],
  removedNodeIds: ReadonlySet<string>,
): CanvasEdge[] => {
  if (removedNodeIds.size === 0) return edges;
  const kept = edges.filter(edge => (
    !(edge.source.kind === 'node' && removedNodeIds.has(edge.source.nodeId))
    && !(edge.target.kind === 'node' && removedNodeIds.has(edge.target.nodeId))
  ));
  return kept.length === edges.length ? edges : kept;
};
