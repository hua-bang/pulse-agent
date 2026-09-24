import { isDeepStrictEqual } from 'node:util';
import type { EntityRecord } from '@pulse-coder/storage';

const CONTENT_FIELDS = ['type', 'title', 'data', 'properties', 'links'] as const;

export type LegacyNodeConflictReason =
  /** canvas.json carried the node without content while its node file had it. */
  | 'empty-inline-data'
  /** The node file's `updatedAt` is newer than the canvas.json copy. */
  | 'node-file-newer'
  /** The canvas.json copy is newer. */
  | 'canvas-newer'
  /** Equal or missing timestamps: canvas.json wins, as in the v1→v2 migration. */
  | 'canvas-default';

export interface LegacyNodeConflict {
  workspaceId: string;
  nodeId: string;
  kept: 'canvas.json' | 'node-file';
  reason: LegacyNodeConflictReason;
  canvasUpdatedAt: number | null;
  nodeFileUpdatedAt: number | null;
  /** Both copies of every field that differed, so either side can be restored by hand. */
  canvas: Record<string, unknown>;
  nodeFile: Record<string, unknown>;
}

const hasContent = (value: unknown): boolean =>
  !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
const timestamp = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Choose between a v1 canvas.json node and its `nodes/<id>.json` record with
 * the same rules as the app's v1→v2 migration: a node file wins when the
 * inline copy lost its content or when it is strictly newer; otherwise the
 * canvas.json copy wins. The losing copy is reported, never discarded.
 */
export function arbitrateLegacyNode(
  workspaceId: string,
  node: EntityRecord,
  atom: EntityRecord,
): { node: EntityRecord; conflict?: LegacyNodeConflict } {
  const differing = CONTENT_FIELDS.filter(field => (
    node[field] !== undefined && atom[field] !== undefined && !isDeepStrictEqual(node[field], atom[field])
  ));
  if (!differing.length) return { node };
  const canvasUpdatedAt = timestamp(node.updatedAt);
  const nodeFileUpdatedAt = timestamp(atom.updatedAt);
  let reason: LegacyNodeConflictReason;
  if (!hasContent(node.data) && (hasContent(atom.data) || (Array.isArray(atom.links) && atom.links.length > 0))) {
    reason = 'empty-inline-data';
  } else if ((canvasUpdatedAt ?? Number.POSITIVE_INFINITY) < (nodeFileUpdatedAt ?? 0)) {
    reason = 'node-file-newer';
  } else {
    reason = canvasUpdatedAt !== null && nodeFileUpdatedAt !== null && canvasUpdatedAt > nodeFileUpdatedAt
      ? 'canvas-newer' : 'canvas-default';
  }
  const kept = reason === 'empty-inline-data' || reason === 'node-file-newer' ? 'node-file' : 'canvas.json';
  const conflict: LegacyNodeConflict = {
    workspaceId, nodeId: node.id, kept, reason, canvasUpdatedAt, nodeFileUpdatedAt,
    canvas: Object.fromEntries(differing.map(field => [field, node[field]])),
    nodeFile: Object.fromEntries(differing.map(field => [field, atom[field]])),
  };
  if (kept === 'canvas.json') return { node, conflict };
  // The node file wins wholesale, as it does once a workspace is on the v2 layout.
  const winner: EntityRecord = { ...node };
  for (const field of [...CONTENT_FIELDS, 'updatedAt'] as const) {
    if (atom[field] === undefined) delete winner[field];
    else winner[field] = atom[field];
  }
  return { node: winner, conflict };
}
