import type { CanvasEdge, CanvasNode, CanvasSaveData } from '../../../types';

type Value = unknown;
const object = (value: Value): value is Record<string, Value> => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
);

export function equalDocumentValue(left: Value, right: Value): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => equalDocumentValue(item, right[index]));
  }
  if (!object(left) || !object(right)) return false;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every(key => equalDocumentValue(left[key], right[key]));
}

export function copyDocument(data: CanvasSaveData): CanvasSaveData {
  return JSON.parse(JSON.stringify({
    ...data,
    edges: data.edges ?? [],
    transform: data.transform ?? { x: 0, y: 0, scale: 1 },
    savedAt: data.savedAt ?? '',
  })) as CanvasSaveData;
}

export function sameDocumentContent(left: CanvasSaveData, right: CanvasSaveData): boolean {
  return equalDocumentValue(left.nodes, right.nodes)
    && equalDocumentValue(left.edges ?? [], right.edges ?? [])
    && equalDocumentValue(left.transform, right.transform);
}

function mergeValue(base: Value, local: Value, remote: Value, path: string, conflicts: string[]): Value {
  if (equalDocumentValue(local, base)) return remote;
  if (equalDocumentValue(remote, base) || equalDocumentValue(local, remote)) return local;
  if (object(base) && object(local) && object(remote)) {
    const merged = Object.create(null) as Record<string, Value>;
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeValue(base[key], local[key], remote[key], `${path}.${key}`, conflicts);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }
  // Arrays are atomic fields: text/topic/order edits have no safe scalar merge.
  conflicts.push(path);
  return local;
}

function semanticRecord<T extends CanvasNode | CanvasEdge>(value: T | undefined): Value {
  if (!value) return undefined;
  const { updatedAt: _timestamp, ...semantic } = value;
  return semantic;
}

function mergeEntities<T extends CanvasNode | CanvasEdge>(
  base: T[], local: T[], remote: T[], path: string, conflicts: string[],
): T[] {
  const byId = (items: T[]) => new Map(items.map(item => [item.id, item]));
  const bases = byId(base);
  const locals = byId(local);
  const remotes = byId(remote);
  const merged = new Map<string, T>();
  for (const id of new Set([...bases.keys(), ...locals.keys(), ...remotes.keys()])) {
    const current = mergeValue(
      semanticRecord(bases.get(id)), semanticRecord(locals.get(id)), semanticRecord(remotes.get(id)),
      `${path}.${id}`, conflicts,
    );
    if (!object(current)) continue;
    const timestamps = [bases.get(id)?.updatedAt, locals.get(id)?.updatedAt, remotes.get(id)?.updatedAt]
      .filter((value): value is number => typeof value === 'number');
    merged.set(id, {
      ...current,
      ...(timestamps.length ? { updatedAt: Math.max(...timestamps) } : {}),
    } as T);
  }

  // Concurrent membership changes can coexist; conflicting reorders cannot.
  const common = new Set(base.filter(item => locals.has(item.id) && remotes.has(item.id)).map(item => item.id));
  const order = (items: T[]) => items.filter(item => common.has(item.id)).map(item => item.id);
  const baseOrder = order(base);
  const localOrder = order(local);
  const remoteOrder = order(remote);
  const localReordered = !equalDocumentValue(localOrder, baseOrder);
  const remoteReordered = !equalDocumentValue(remoteOrder, baseOrder);
  if (localReordered && remoteReordered && !equalDocumentValue(localOrder, remoteOrder)) {
    conflicts.push(`${path}.order`);
  }
  const preferred = localReordered ? local : remote;
  const ids = new Set([...preferred.map(item => item.id), ...local.map(item => item.id), ...remote.map(item => item.id)]);
  const successors = new Map<string, Set<string>>();
  const incoming = new Map([...merged.keys()].map(id => [id, 0]));
  const secondary = preferred === local ? remote : local;
  for (const [index, sequence] of [preferred, secondary].entries()) {
    const present = sequence.filter(item => merged.has(item.id));
    for (let i = 1; i < present.length; i += 1) {
      const before = present[i - 1].id;
      const after = present[i].id;
      // An unchanged baseline order must not veto the other side's reorder.
      if (index === 1 && localReordered !== remoteReordered && bases.has(before) && bases.has(after)) continue;
      const following = successors.get(before) ?? new Set<string>();
      if (!following.has(after)) incoming.set(after, incoming.get(after)! + 1);
      following.add(after);
      successors.set(before, following);
    }
  }
  const ordered: T[] = [];
  const remaining = [...ids].filter(id => merged.has(id));
  while (remaining.length) {
    const index = remaining.findIndex(id => incoming.get(id) === 0);
    if (index < 0) {
      if (!conflicts.includes(`${path}.order`)) conflicts.push(`${path}.order`);
      break;
    }
    const [id] = remaining.splice(index, 1);
    ordered.push(merged.get(id)!);
    for (const next of successors.get(id) ?? []) incoming.set(next, incoming.get(next)! - 1);
  }
  return ordered;
}

export function mergeDocumentRevision(
  base: CanvasSaveData,
  local: CanvasSaveData,
  remote: CanvasSaveData,
  options: { allowStorageGenerationChange?: boolean } = {},
):
  | { ok: true; data: CanvasSaveData }
  | { ok: false; conflicts: string[] } {
  if (base.storageGeneration !== remote.storageGeneration && !options.allowStorageGenerationChange) {
    return { ok: false, conflicts: ['storageGeneration'] };
  }
  const conflicts: string[] = [];
  const nodes = mergeEntities(base.nodes, local.nodes, remote.nodes, 'nodes', conflicts);
  const edges = mergeEntities(base.edges ?? [], local.edges ?? [], remote.edges ?? [], 'edges', conflicts);
  const transform = mergeValue(base.transform, local.transform, remote.transform, 'transform', conflicts);
  if (conflicts.length) return { ok: false, conflicts };
  return {
    ok: true,
    data: copyDocument({ ...remote, nodes, edges, transform: transform as CanvasSaveData['transform'] }),
  };
}
