/**
 * Pure decision core for reconciling the renderer's in-memory node list
 * with whatever is currently on disk when persisting a canvas.
 *
 * Extracted from `canvas/store.ts` so it can be unit-tested without pulling
 * in Electron (`store.ts` imports `ipcMain`/`BrowserWindow`, which can't be
 * loaded under vitest). `store.ts` reads disk + does the logging/echo
 * bookkeeping; this module only decides which nodes survive.
 */

/** Minimal node shape the merge cares about: identity + recency. */
export interface MergeNode {
  id?: string;
  updatedAt?: number;
  [k: string]: unknown;
}

export type NodeMergeDecision<T extends MergeNode> =
  /**
   * The empty-overwrite safety guard tripped: in-memory is empty but disk
   * still has nodes, and the caller is not authoritative. The save handler
   * keeps the on-disk nodes rather than wiping them.
   */
  | { kind: 'preserve-disk' }
  /** Write `nodes` to disk. `shrinkPreserved` is populated only when the
   *  suspicious-shrink guard kept disk nodes the memory snapshot dropped,
   *  so the caller can log why. */
  | {
      kind: 'write';
      nodes: T[];
      shrinkPreserved?: { memory: number; missing: number; knownDisk: number };
    };

interface DecideOptions {
  /**
   * Set when the save originates from a fully-loaded renderer, whose
   * snapshot is therefore a COMPLETE picture of the canvas. It relaxes the
   * two anti-data-loss guards below that would otherwise resurrect nodes
   * the user just deleted:
   *
   *   - the empty-overwrite guard (user deleted every node), and
   *   - the suspicious-shrink guard (user deleted many nodes at once).
   *
   * Both guards stay active for non-authoritative writers (canvas-cli, or
   * an early-lifecycle flush that fires before the renderer finished
   * loading) which cannot vouch that a short/empty list is a real user
   * deletion rather than a partial/half-loaded snapshot.
   */
  authoritative?: boolean;
}

/**
 * Decide which node list to persist.
 *
 * Rules (applied in order), preserving the historical `store.ts` behavior:
 *
 *   1. Per-node "newer wins" by `updatedAt` for nodes present in BOTH
 *      memory and disk. A memory node with no `updatedAt` is treated as
 *      older than any timestamped disk version (the common case where the
 *      CLI just wrote the disk copy with a timestamp).
 *   2. Add disk-only nodes whose ids have NEVER been seen by Electron
 *      (`known`) — that's how canvas-cli creates surface. Disk-only ids
 *      that ARE known were deleted in the UI and must not be re-added.
 *   3. (non-authoritative only) If the memory snapshot looks suspiciously
 *      smaller than what was already persisted, keep the missing-from-
 *      memory disk nodes — they're probably a partial snapshot (load race
 *      / HMR / double-mount), not a real bulk delete.
 *
 * `known` is read-only here; the caller owns updating it after the write
 * lands (see the note in `store.ts`).
 */
export const decideNodeMerge = <T extends MergeNode>(
  memoryNodes: T[],
  diskNodes: T[],
  known: Set<string>,
  options: DecideOptions = {},
): NodeMergeDecision<T> => {
  const authoritative = options.authoritative === true;

  // Hard safety: never let a save with an empty node list clobber a
  // non-empty on-disk canvas — UNLESS the caller is authoritative, in
  // which case an empty list is a deliberate "delete every node" the user
  // expects to stick (and to be reversible via undo). Without the
  // authoritative escape hatch this guard refuses the write AND the save
  // handler then broadcasts the still-on-disk nodes back to the renderer,
  // resurrecting whatever the user just deleted.
  if (!authoritative && memoryNodes.length === 0 && diskNodes.length > 0) {
    return { kind: 'preserve-disk' };
  }

  const diskById = new Map<string, T>();
  for (const n of diskNodes) {
    if (n.id) diskById.set(n.id, n);
  }

  // Rule 1: reconcile nodes that are in memory.
  const mergedExisting: T[] = [];
  for (const memNode of memoryNodes) {
    if (!memNode.id) {
      mergedExisting.push(memNode);
      continue;
    }
    const diskNode = diskById.get(memNode.id);
    if (!diskNode) {
      // Only memory has it. Known → CLI deleted it between load and this
      // save, drop it. Unknown → user just created it, keep.
      if (known.has(memNode.id)) continue;
      mergedExisting.push(memNode);
      continue;
    }
    const memTs = typeof memNode.updatedAt === 'number' ? memNode.updatedAt : 0;
    const diskTs = typeof diskNode.updatedAt === 'number' ? diskNode.updatedAt : 0;
    mergedExisting.push(diskTs > memTs ? diskNode : memNode);
  }

  // Rule 2: nodes only on disk and never-seen → CLI creates, add them.
  const memoryIds = new Set(
    memoryNodes.map((n) => n.id).filter((id): id is string => Boolean(id)),
  );
  const externalNewNodes = diskNodes.filter(
    (n) => n.id && !memoryIds.has(n.id) && !known.has(n.id),
  );

  // Rule 3: partial-snapshot safety net (non-authoritative only). When a
  // lot of previously-persisted nodes vanished from a much-smaller memory
  // snapshot, treat it as a half-loaded snapshot and preserve them.
  const missingKnownDiskNodes = diskNodes.filter(
    (n) => !!n.id && known.has(n.id) && !memoryIds.has(n.id),
  );
  const knownDiskCount = diskNodes.reduce(
    (count, n) => (n.id && known.has(n.id) ? count + 1 : count),
    0,
  );
  const suspiciousShrink =
    !authoritative &&
    missingKnownDiskNodes.length >= 5 &&
    knownDiskCount > 0 &&
    missingKnownDiskNodes.length / knownDiskCount >= 0.5 &&
    memoryNodes.length < missingKnownDiskNodes.length;

  const preservedMissing = suspiciousShrink ? missingKnownDiskNodes : [];

  return {
    kind: 'write',
    nodes: [...mergedExisting, ...externalNewNodes, ...preservedMissing],
    shrinkPreserved: suspiciousShrink
      ? {
          memory: memoryNodes.length,
          missing: missingKnownDiskNodes.length,
          knownDisk: knownDiskCount,
        }
      : undefined,
  };
};
