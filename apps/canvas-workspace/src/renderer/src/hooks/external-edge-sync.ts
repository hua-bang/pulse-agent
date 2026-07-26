import type { CanvasEdge } from '../types';

export const mergeExternalEdgeUpdate = (
  current: CanvasEdge[],
  disk: CanvasEdge[],
  changedIds: ReadonlySet<string>,
  persistedIds: ReadonlySet<string>,
): CanvasEdge[] => {
  if (changedIds.size === 0) return current;
  const diskById = new Map(disk.map((edge) => [edge.id, edge]));
  const seen = new Set<string>();
  const next: CanvasEdge[] = [];
  for (const edge of current) {
    seen.add(edge.id);
    if (!changedIds.has(edge.id)) {
      next.push(edge);
      continue;
    }
    const diskEdge = diskById.get(edge.id);
    if (diskEdge) next.push(diskEdge);
    else if (!persistedIds.has(edge.id)) next.push(edge);
  }
  for (const id of changedIds) {
    if (!seen.has(id) && diskById.has(id)) next.push(diskById.get(id)!);
  }
  return next;
};
