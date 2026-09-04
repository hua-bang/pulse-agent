/**
 * Canvas storage helpers.
 *
 * Shared, pure-ish module used by `canvas-store.ts` (Electron main IPC) and —
 * post-PR2/3 — by `mcp-server.ts`, `canvas-agent/*`, `artifact-ipc.ts`, and
 * the (separately-packaged) `canvas-cli`. No Electron imports here so the
 * module is unit-testable in plain Node.
 *
 * This file is the stable compatibility facade for full-canvas reads, writes,
 * and v1→v2 migration. Owner-local path, atomic JSON, schema, and pollution
 * behavior lives under `persistence/`; callers continue importing this file.
 *
 * v1 vs v2 storage layout:
 *
 *   v1 (legacy, migrated lazily):
 *     ~/.pulse-coder/canvas/<id>/canvas.json   ← layout + ALL node.data inline
 *
 *   v2 (current):
 *     ~/.pulse-coder/canvas/<id>/canvas.json   ← layout-only (no node.data)
 *     ~/.pulse-coder/canvas/<id>/nodes/<nodeId>.json
 *                                              ← self-describing per-node file
 *
 * Migration is workspace-scoped and atomic at the canvas.json swap.
 */

import { promises as fs } from 'fs';
import { dirname } from 'path';
import {
  deleteWorkspaceNode,
  listWorkspaceNodeIds,
  mutateWorkspaceNode,
  readWorkspaceNode,
  writeWorkspaceNode,
} from './nodes/store';
import {
  CANVAS_JSON_FILENAME,
  MANIFEST_ID,
  MIGRATION_SENTINEL_FILENAME,
  NODES_DIR_NAME,
  STORE_DIR,
  V1_BACKUP_FILENAME,
  assertSafeNodeId,
  getCanvasJsonPath,
  getNodeFilePath,
  getNodesDir,
  getSentinelPath,
  getV1BackupPath,
  getV1TimestampedBackupPath,
  getWorkspaceDir,
  isSafeNodeId,
} from './persistence/paths';
import {
  atomicWriteJson,
  readJsonWithRecovery,
  type ReadJsonResult,
} from './persistence/atomic-json';
import {
  CANVAS_SCHEMA_VERSION_V2,
  PER_NODE_SCHEMA_VERSION,
  detectSchemaVersion,
  type CanvasNode,
  type CanvasSaveData,
  type MigrationProgress,
  type MigrationSentinel,
  type PerNodeFile,
  type ReadCanvasResult,
  type SchemaVersion,
} from './persistence/schema';
import {
  CanvasPollutionDetectedError,
  detectV1Pollution,
  scanForPollutedWorkspaces,
} from './persistence/pollution';
import {
  clearMigrationActive,
  deleteSentinel,
  isMigrationActive,
  markMigrationActive,
  readSentinel,
  recoverInterruptedMigration,
  writeSentinel,
} from './persistence/migration-recovery';

export {
  CANVAS_JSON_FILENAME,
  MANIFEST_ID,
  MIGRATION_SENTINEL_FILENAME,
  NODES_DIR_NAME,
  STORE_DIR,
  V1_BACKUP_FILENAME,
  assertSafeNodeId,
  atomicWriteJson,
  getCanvasJsonPath,
  getNodeFilePath,
  getNodesDir,
  getSentinelPath,
  getV1BackupPath,
  getV1TimestampedBackupPath,
  getWorkspaceDir,
  isSafeNodeId,
  readJsonWithRecovery,
};
export type { ReadJsonResult };
export {
  CANVAS_SCHEMA_VERSION_V2,
  PER_NODE_SCHEMA_VERSION,
  CanvasPollutionDetectedError,
  detectSchemaVersion,
  detectV1Pollution,
  scanForPollutedWorkspaces,
};
export type {
  CanvasNode,
  CanvasSaveData,
  MigrationProgress,
  MigrationSentinel,
  PerNodeFile,
  ReadCanvasResult,
  SchemaVersion,
  WorkspaceNodeLink,
  WorkspaceNodePropertyValue,
  WorkspaceNodeRecord,
} from './persistence/schema';
export {
  clearMigrationActive,
  deleteSentinel,
  isMigrationActive,
  markMigrationActive,
  readSentinel,
  recoverInterruptedMigration,
  writeSentinel,
};

// ─────────────────────────────────────────────────────────────────────────────
// Per-node I/O

/**
 * Read a single per-node file. Returns null if missing or unparseable —
 * callers fall back to a type-default `data` and surface a warning, rather
 * than failing the whole workspace load on one bad file.
 */
export async function readNodeFile(
  workspaceId: string,
  nodeId: string,
  root: string = STORE_DIR,
): Promise<PerNodeFile | null> {
  return readWorkspaceNode(workspaceId, nodeId, root);
}

/** Atomically write a per-node file. No rolling backup — these are small and replaceable. */
export async function writeNodeFile(
  workspaceId: string,
  file: PerNodeFile,
  root: string = STORE_DIR,
): Promise<void> {
  await writeWorkspaceNode(workspaceId, file, root);
}

export async function deleteNodeFile(
  workspaceId: string,
  nodeId: string,
  root: string = STORE_DIR,
): Promise<void> {
  await deleteWorkspaceNode(workspaceId, nodeId, root);
}

/** List `<nodeId>` for every parseable per-node file in the workspace. */
export async function listNodeFiles(
  workspaceId: string,
  root: string = STORE_DIR,
): Promise<string[]> {
  return listWorkspaceNodeIds(workspaceId, root);
}

// ─────────────────────────────────────────────────────────────────────────────
// Full read / write

/**
 * Read the workspace's canvas in v1-shape (with `node.data` inline),
 * regardless of on-disk format.
 *
 * Auto-runs sentinel recovery before any I/O so an interrupted migration
 * always self-heals. Does NOT trigger migration on its own — PR1 keeps that
 * gated. Once PR3 lands, this is where lazy auto-migration hooks in.
 */
export async function readCanvasFull(
  workspaceId: string,
  root: string = STORE_DIR,
): Promise<ReadCanvasResult> {
  await recoverInterruptedMigration(workspaceId, root);

  const canvasPath = getCanvasJsonPath(workspaceId, root);
  const result = await readJsonWithRecovery<CanvasSaveData>(canvasPath);
  if (result.kind === 'missing') {
    return { data: null, recoveredFromBackup: false, schemaVersion: null };
  }
  if (result.kind === 'unrecoverable') {
    throw result.err;
  }

  const parsed = result.data;
  const version = detectSchemaVersion(parsed);

  if (version === 1) {
    // v1 already has inline data — return as-is.
    return {
      data: parsed,
      recoveredFromBackup: result.recoveredFromBackup,
      schemaVersion: 1,
    };
  }

  // v2: assemble layout + per-node files into v1-shape for the caller.
  const assembled = await assembleV2(workspaceId, parsed, root);
  return {
    data: assembled,
    recoveredFromBackup: result.recoveredFromBackup,
    schemaVersion: 2,
  };
}

/**
 * Assemble a v1-shape `CanvasSaveData` from a v2 layout + per-node files.
 * Missing per-node files fall back to empty `data` with a warning; we never
 * fail the whole workspace because of one bad file.
 *
 * Drift handling: if `canvas.json`'s denormalized `type`/`title` disagree
 * with the per-node file, the per-node file wins (canonical) and a warning
 * is logged. The repair write happens at the next normal save — we don't
 * sneak side-effect writes into a "read" call.
 */
async function assembleV2(
  workspaceId: string,
  layout: CanvasSaveData,
  root: string,
): Promise<CanvasSaveData> {
  const layoutNodes = Array.isArray(layout.nodes) ? layout.nodes : [];

  const assembledNodes = await Promise.all(
    layoutNodes.map(async (layoutNode) => {
      if (isLayoutOnlyReferenceNode(layoutNode)) {
        return layoutNode;
      }
      const id = typeof layoutNode.id === 'string' ? layoutNode.id : null;
      if (!id) {
        // Layout entry without an id — degrade gracefully with empty data
        // rather than crashing. Should never happen in practice.
        return { ...layoutNode, data: {} as Record<string, unknown> };
      }
      const perNode = await readNodeFile(workspaceId, id, root);
      if (!perNode) {
        console.warn(
          `[canvas-storage] node ${id} in ${workspaceId} has no per-node file; using empty data`,
        );
        return { ...layoutNode, data: {} as Record<string, unknown> };
      }
      // Drift check (per-node file is canonical).
      if (perNode.type !== layoutNode.type) {
        console.warn(
          `[canvas-storage] drift on ${id}: layout.type=${String(layoutNode.type)} vs per-node.type=${perNode.type}; preferring per-node`,
        );
      }
      return {
        ...layoutNode,
        type: perNode.type,
        title: perNode.title ?? layoutNode.title,
        data: perNode.data,
        properties: perNode.properties,
        links: perNode.links,
        updatedAt: perNode.updatedAt ?? layoutNode.updatedAt,
      } as CanvasNode;
    }),
  );

  const out: CanvasSaveData = { ...layout, nodes: assembledNodes };
  // Don't leak the v2 marker upward; callers expect v1-shape unmarked.
  delete out.schemaVersion;
  return out;
}

/**
 * Write a full canvas (v1-shape input) to disk, matching whatever schema
 * version is currently on disk. Fresh workspaces default to v2 so they don't
 * immediately trip the lazy migration toast on first load.
 */
export async function writeCanvasFull(
  workspaceId: string,
  data: CanvasSaveData,
  root: string = STORE_DIR,
): Promise<void> {
  const canvasPath = getCanvasJsonPath(workspaceId, root);
  await fs.mkdir(dirname(canvasPath), { recursive: true });

  // Detect current on-disk version. Fresh workspace → default to v2 now
  // that lazy migration is active; callers can still request v1 explicitly
  // with `data.schemaVersion = 1` for recovery/compat tests.
  const existing = await readJsonWithRecovery<CanvasSaveData>(canvasPath);
  const currentVersion: SchemaVersion =
    existing.kind === 'ok'
      ? detectSchemaVersion(existing.data)
      : data.schemaVersion === 1
        ? 1
        : CANVAS_SCHEMA_VERSION_V2;

  if (currentVersion === 1) {
    // Pollution guard: if any incoming node id has a corresponding v2
    // per-node file on disk, refuse. Writing v1-shape would set up the
    // workspace for a destructive re-migration on the next read (the
    // exact bug that motivated this check). Migration is the only path
    // that should ever produce a transition from v2-backed nodes to a
    // v1 canvas.json, and migration runs in the other direction.
    const conflicts = await detectV1Pollution(workspaceId, data.nodes, root);
    if (conflicts.length > 0) {
      throw new CanvasPollutionDetectedError(workspaceId, conflicts);
    }
    // Preserve v1 inline layout. Strip any stray schemaVersion the caller
    // may have set so the written file stays cleanly v1.
    const payload: CanvasSaveData = { ...data };
    delete payload.schemaVersion;
    await atomicWriteJson(
      canvasPath,
      JSON.stringify(payload, null, 2),
      { rollingBackup: true },
    );
    return;
  }

  // v2: split into layout + per-node files. Per-node writes happen first;
  // the canvas.json swap is the commit point.
  await writeCanvasFullV2(workspaceId, data, root);
}

async function writeCanvasFullV2(
  workspaceId: string,
  data: CanvasSaveData,
  root: string,
): Promise<void> {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const now = Date.now();

  // 1. Write per-node files for every node. Use updatedAt arbitration: if
  //    the on-disk per-node file is newer, keep it (defends against a stale
  //    in-memory snapshot clobbering a fresh CLI-side edit).
  for (const node of nodes) {
    const nodeId = node.id;
    if (!nodeId || !isSafeNodeId(nodeId)) continue;
    if (isLayoutOnlyReferenceNode(node)) continue;

    await mutateWorkspaceNode(workspaceId, nodeId, (existing) => {
      const incomingUpdatedAt = typeof node.updatedAt === 'number' ? node.updatedAt : now;
      const existingUpdatedAt = existing && typeof existing.updatedAt === 'number' ? existing.updatedAt : 0;

      if (existing && existingUpdatedAt > incomingUpdatedAt) {
        // Disk is newer — preserve it. This arbitration runs under the same
        // per-node lock as proposal and IPC mutations, so a stale full save
        // cannot read before a mutation and write after it.
        return { result: undefined };
      }

      const file: PerNodeFile = {
        schemaVersion: PER_NODE_SCHEMA_VERSION,
        id: nodeId,
        type: node.type,
        title: node.title,
        data: (node.data ?? {}) as Record<string, unknown>,
        properties: node.properties ?? existing?.properties,
        links: node.links ?? existing?.links,
        updatedAt: incomingUpdatedAt,
        createdAt: existing?.createdAt ?? incomingUpdatedAt,
      };
      return { record: file, result: undefined };
    }, root);
  }

  // 2. Do not delete per-node files omitted from the incoming layout. In v2,
  //    nodes/<id>.json is treated as the workspace-scoped atom store; a
  //    canvas save only updates the current layout projection. Orphan cleanup
  //    should be an explicit atom-store operation, not a side effect of saving
  //    a canvas view.

  // 3. Construct the v2 layout: strip data, keep everything else.
  const layout: CanvasSaveData = {
    ...data,
    schemaVersion: 2,
    nodes: nodes.map((n) => stripDataFromNode(n)),
  };

  // 4. COMMIT POINT — atomic canvas.json swap. Rolling backup of the
  //    previous v2 file rotates here.
  await atomicWriteJson(
    getCanvasJsonPath(workspaceId, root),
    JSON.stringify(layout, null, 2),
    { rollingBackup: true },
  );
}

function stripDataFromNode(node: CanvasNode): CanvasNode {
  if (isLayoutOnlyReferenceNode(node)) return node;
  const { data: _data, properties: _properties, links: _links, ...rest } = node;
  return rest;
}

function isLayoutOnlyReferenceNode(node: CanvasNode): boolean {
  return !!node
    && typeof node === 'object'
    && node.type === 'reference'
    && node.ref != null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Migration

/**
 * Migrate a workspace from v1 → v2.
 *
 *   1. write `.migrating` sentinel
 *   2. snapshot v1 canvas.json → `canvas.json.v1.bak` (permanent archive)
 *   3. atomic-write each `nodes/<id>.json` (per-node updatedAt wins if file
 *      already exists — defends against a concurrent newer write)
 *   4. atomic-write v2 canvas.json     ← commit point
 *   5. delete sentinel
 *
 * Idempotent: if called against an already-v2 workspace, returns immediately.
 * Crash-safe at every step via the sentinel + .v1.bak — see
 * `recoverInterruptedMigration`.
 *
 * The progress callback fires at well-defined phase boundaries and per-node
 * inside `split-nodes`; throttle in the caller if needed.
 */
export async function migrateToV2(
  workspaceId: string,
  opts: { onProgress?: (p: MigrationProgress) => void; root?: string } = {},
): Promise<void> {
  const root = opts.root ?? STORE_DIR;
  const onProgress = opts.onProgress ?? (() => undefined);

  // Mark active *before* writing the sentinel so any concurrent
  // `readCanvasFull` in this process sees the live-migration flag and
  // skips recovery — recovery here would clean up our in-flight writes.
  markMigrationActive(workspaceId);
  try {
    onProgress({ phase: 'starting' });

    // Pre-flight: recover any leftover sentinel from a *previous*
    // interrupted run. With the active flag set above, this won't be a
    // self-recovery — it strictly handles past crashes.
    clearMigrationActive(workspaceId); // temporarily clear so the
    // pre-flight recovery can actually inspect the sentinel
    await recoverInterruptedMigration(workspaceId, root);
    markMigrationActive(workspaceId);

    const canvasPath = getCanvasJsonPath(workspaceId, root);
    const existing = await readJsonWithRecovery<CanvasSaveData>(canvasPath);
    if (existing.kind === 'missing') {
      // Nothing to migrate.
      onProgress({ phase: 'done' });
      return;
    }
    if (existing.kind === 'unrecoverable') {
      throw existing.err;
    }
    if (detectSchemaVersion(existing.data) === 2) {
      onProgress({ phase: 'done' });
      return;
    }

    const v1 = existing.data;
    const nodes = Array.isArray(v1.nodes) ? v1.nodes : [];

    // Pollution guard. If any v1 node id already has a v2 per-node file
    // on disk, the v1-shape we just loaded almost certainly came from a
    // v1-unaware writer (old binary or external script) clobbering
    // canvas.json — the real data is still in those per-node files, and
    // running the migration here would let updatedAt arbitration
    // overwrite them with the empty-data v1 layout. Bail loudly; the
    // upstream IPC handler surfaces this to the renderer so the user
    // can recover before any damage is done.
    const conflicts = await detectV1Pollution(workspaceId, nodes, root);
    if (conflicts.length > 0) {
      throw new CanvasPollutionDetectedError(workspaceId, conflicts);
    }

    const expectedNodeIds = nodes
      .map((n) => n.id)
      .filter((id): id is string => typeof id === 'string' && isSafeNodeId(id));

    // 1. Sentinel first, before anything destructive.
    const sentinel: MigrationSentinel = {
      startedAt: Date.now(),
      workspaceId,
      sourceUpdatedAt: extractWorkspaceUpdatedAt(v1),
      expectedNodeIds,
    };
    await writeSentinel(workspaceId, sentinel, root);

    // 2. Permanent v1 archive. Two files are written:
    //
    //    a) `canvas.json.v1.<ISO>.bak` — immutable historical record.
    //       Never overwritten by subsequent migrations; even a future
    //       pollution-triggered re-migration (which the guard above is
    //       designed to prevent, but might be bypassed by future changes)
    //       cannot destroy this snapshot. Users can `ls *.v1.*.bak` to
    //       see the full migration history.
    //
    //    b) `canvas.json.v1.bak` — stable alias for backward compatibility
    //       with the documented manual recovery procedure. Always points
    //       at the same bytes as the latest timestamped archive.
    //
    //    Copy the raw bytes (not the parsed value) to preserve exact
    //    byte-level state, including any user-meaningful formatting.
    onProgress({ phase: 'backup' });
    await fs.copyFile(
      canvasPath,
      getV1TimestampedBackupPath(workspaceId, new Date(sentinel.startedAt), root),
    );
    await fs.copyFile(canvasPath, getV1BackupPath(workspaceId, root));

    // 3. Per-node files. Sequential to keep memory and FS pressure modest;
    //    a typical workspace has tens of nodes, big ones have hundreds.
    const total = nodes.length;
    let current = 0;
    for (const node of nodes) {
      if (!node.id || !isSafeNodeId(node.id)) {
        // Defensive: skip but don't fail the migration on one bad id.
        current += 1;
        onProgress({ phase: 'split-nodes', current, total });
        continue;
      }
      if (isLayoutOnlyReferenceNode(node)) {
        current += 1;
        onProgress({ phase: 'split-nodes', current, total });
        continue;
      }

      const incomingUpdatedAt =
        typeof node.updatedAt === 'number' ? node.updatedAt : sentinel.startedAt;

      // updatedAt arbitration. The per-node file shouldn't exist yet on
      // first-time migration, but if it does (interrupted migration retry,
      // or a parallel writer raced in), keep the newer copy.
      const existingPerNode = await readNodeFile(workspaceId, node.id, root);
      const existingUpdatedAt =
        existingPerNode && typeof existingPerNode.updatedAt === 'number'
          ? existingPerNode.updatedAt
          : 0;

      if (!existingPerNode || incomingUpdatedAt >= existingUpdatedAt) {
        const file: PerNodeFile = {
          schemaVersion: PER_NODE_SCHEMA_VERSION,
          id: node.id,
          type: node.type,
          title: node.title,
          data: (node.data ?? {}) as Record<string, unknown>,
          properties: node.properties ?? existingPerNode?.properties,
          links: node.links ?? existingPerNode?.links,
          updatedAt: incomingUpdatedAt,
          createdAt: existingPerNode?.createdAt ?? incomingUpdatedAt,
        };
        await writeNodeFile(workspaceId, file, root);
      }

      current += 1;
      onProgress({ phase: 'split-nodes', current, total });
    }

    // 4. Commit. Build v2 layout and atomic-write canvas.json. From this
    //    rename onward, the workspace is v2.
    onProgress({ phase: 'commit' });
    const layout: CanvasSaveData = {
      ...v1,
      schemaVersion: 2,
      nodes: nodes.map((n) => stripDataFromNode(n)),
    };
    await atomicWriteJson(
      canvasPath,
      JSON.stringify(layout, null, 2),
      { rollingBackup: true },
    );

    // 5. Remove sentinel. From now on, recovery has nothing to do.
    await deleteSentinel(workspaceId, root);

    onProgress({ phase: 'done' });
  } finally {
    clearMigrationActive(workspaceId);
  }
}

/**
 * Best-effort newest `updatedAt` across the v1 canvas — used in the sentinel
 * to help debug "what version of the data did we start from".
 */
function extractWorkspaceUpdatedAt(v1: CanvasSaveData): number | null {
  let max: number | null = null;
  const nodes = Array.isArray(v1.nodes) ? v1.nodes : [];
  for (const n of nodes) {
    if (typeof n.updatedAt === 'number' && (max === null || n.updatedAt > max)) {
      max = n.updatedAt;
    }
  }
  return max;
}
