import { promises as fs } from 'node:fs';

export interface SyncableEdge {
  id: string;
  label?: string;
  updatedAt?: number;
}

export const edgesToMap = <T extends SyncableEdge>(
  edges: T[] | undefined,
): Map<string, T> => new Map((edges ?? []).map((edge) => [edge.id, edge]));

export const readOnDiskEdgeMap = async <T extends SyncableEdge>(
  filePath: string,
): Promise<Map<string, T>> => {
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, 'utf-8')) as { edges?: T[] };
    return edgesToMap(parsed.edges);
  } catch {
    return new Map<string, T>();
  }
};

export const mergeExternalEdges = <T extends SyncableEdge>(
  memoryEdges: T[],
  diskEdges: T[],
  known: ReadonlySet<string>,
): T[] => {
  const diskById = edgesToMap(diskEdges);
  const memoryIds = new Set(memoryEdges.map((edge) => edge.id));
  const merged: T[] = [];
  for (const memoryEdge of memoryEdges) {
    const diskEdge = diskById.get(memoryEdge.id);
    if (!diskEdge) {
      if (!known.has(memoryEdge.id)) merged.push(memoryEdge);
      continue;
    }
    merged.push((diskEdge.updatedAt ?? 0) > (memoryEdge.updatedAt ?? 0) ? diskEdge : memoryEdge);
  }
  for (const diskEdge of diskEdges) {
    if (!memoryIds.has(diskEdge.id) && !known.has(diskEdge.id)) merged.push(diskEdge);
  }
  return merged;
};
