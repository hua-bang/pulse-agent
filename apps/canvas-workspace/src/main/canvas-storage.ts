/**
 * Canvas storage helpers.
 *
 * Shared, pure-ish module used by `canvas-store.ts` (Electron main IPC) and —
 * post-PR2/3 — by `mcp-server.ts`, `canvas-agent/*`, `artifact-ipc.ts`, and
 * the (separately-packaged) `canvas-cli`. No Electron imports here so the
 * module is unit-testable in plain Node.
 *
 * Today: provides one atomic write implementation, recovery-aware reads, and
 * (dormant) v2 split-storage primitives that are not yet wired up. PR1
 * lands the helpers and tests; PR3 flips on lazy auto-migration once the
 * other consumers are also routing through here.
 *
 * v1 vs v2 storage layout:
 *
 *   v1 (current):
 *     ~/.pulse-coder/canvas/<id>/canvas.json   ← layout + ALL node.data inline
 *
 *   v2 (target):
 *     ~/.pulse-coder/canvas/<id>/canvas.json   ← layout-only (no node.data)
 *     ~/.pulse-coder/canvas/<id>/nodes/<nodeId>.json
 *                                              ← self-describing per-node file
 *
 * Migration is workspace-scoped and atomic at the canvas.json swap.
 */

import { promises as fs } from 'fs';
import { join, basename, dirname } from 'path';
import { homedir } from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// Constants

/** Root for all per-workspace storage. Mirrors `canvas-store.ts`. */
export const STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');

/** Manifest id — flat file at STORE_DIR root, not a workspace directory. */
export const MANIFEST_ID = '__workspaces__';

export const CANVAS_JSON_FILENAME = 'canvas.json';
export const NODES_DIR_NAME = 'nodes';
/** Permanent v1 archive, written once at migration start. Never overwritten. */
export const V1_BACKUP_FILENAME = 'canvas.json.v1.bak';
/** Sentinel; present iff a migration is mid-flight. */
export const MIGRATION_SENTINEL_FILENAME = '.migrating';

/** Current per-node file schema version. */
export const PER_NODE_SCHEMA_VERSION = 1;
/** Target canvas.json schema version once migration completes. */
export const CANVAS_SCHEMA_VERSION_V2 = 2;

// ─────────────────────────────────────────────────────────────────────────────
// Types

/**
 * A single canvas node, v1-shape — what callers and the renderer always work
 * with in memory. `data` is the polymorphic payload that varies by `type`.
 * In v2 on-disk format, `data` lives in `nodes/<id>.json` instead of being
 * inlined here, but assembled reads still hand callers this shape.
 *
 * Intentionally NO `[k: string]: unknown` index signature: consumers
 * (canvas-store, canvas-agent/tools, mcp-server, etc.) have their own
 * strictly-typed `CanvasNode` interfaces and a wildcard signature here
 * would block structural assignment from them. The helper itself only
 * reads named fields, so the wider shape isn't needed.
 */
export interface CanvasNode {
  id?: string;
  type: string;
  title?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  data?: Record<string, unknown>;
  /** Epoch millis of last mutation; used for cross-process merge. */
  updatedAt?: number;
}

/**
 * The full v1-shape canvas data. Returned by `readCanvasFull` regardless of
 * on-disk schema version, accepted by `writeCanvasFull`. `schemaVersion` is
 * the *target* version that should end up on disk after a write; callers
 * don't need to set it (defaults to whatever is currently on disk, or v2 for
 * fresh workspaces post-PR3).
 */
export interface CanvasSaveData {
  schemaVersion?: 1 | 2;
  nodes?: CanvasNode[];
  edges?: unknown[];
  transform?: unknown;
  savedAt?: string;
}

/** On-disk shape of `nodes/<nodeId>.json`. Self-describing for knowledge-base reuse. */
export interface PerNodeFile {
  schemaVersion: typeof PER_NODE_SCHEMA_VERSION;
  id: string;
  type: string;
  title?: string;
  data: Record<string, unknown>;
  updatedAt?: number;
  createdAt?: number;
}

export type SchemaVersion = 1 | 2;

/**
 * Sentinel content written when migration starts. The `expectedNodeIds` list
 * lets recovery cleanup distinguish "partial migration garbage" from user
 * files that happen to live in the nodes/ directory.
 */
export interface MigrationSentinel {
  startedAt: number;
  workspaceId: string;
  sourceUpdatedAt: number | null;
  expectedNodeIds: string[];
}

/**
 * Progress callback payload for `migrateToV2`. Phases run in order; total +
 * current are only meaningful during `split-nodes`. `error` is not emitted
 * by `migrateToV2` itself (it throws on failure) but is included so the
 * canvas-store-side broadcaster can publish error events on the same
 * channel as progress events without a separate type.
 */
export interface MigrationProgress {
  phase: 'starting' | 'backup' | 'split-nodes' | 'commit' | 'done' | 'error';
  current?: number;
  total?: number;
  message?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Path helpers

/** Workspace directory; the layout root for everything else. */
export function getWorkspaceDir(workspaceId: string, root: string = STORE_DIR): string {
  return join(root, workspaceId);
}

/** Path to a workspace's `canvas.json`. Manifest is a flat file at STORE_DIR root. */
export function getCanvasJsonPath(workspaceId: string, root: string = STORE_DIR): string {
  if (workspaceId === MANIFEST_ID) {
    return join(root, `${MANIFEST_ID}.json`);
  }
  return join(getWorkspaceDir(workspaceId, root), CANVAS_JSON_FILENAME);
}

export function getNodesDir(workspaceId: string, root: string = STORE_DIR): string {
  return join(getWorkspaceDir(workspaceId, root), NODES_DIR_NAME);
}

/**
 * Path to a single per-node file. Throws on suspicious node ids to keep
 * path-traversal out of writers — node ids in canvas.json come from disk
 * and could be tampered with.
 */
export function getNodeFilePath(workspaceId: string, nodeId: string, root: string = STORE_DIR): string {
  assertSafeNodeId(nodeId);
  return join(getNodesDir(workspaceId, root), `${nodeId}.json`);
}

export function getV1BackupPath(workspaceId: string, root: string = STORE_DIR): string {
  return join(getWorkspaceDir(workspaceId, root), V1_BACKUP_FILENAME);
}

export function getSentinelPath(workspaceId: string, root: string = STORE_DIR): string {
  return join(getWorkspaceDir(workspaceId, root), MIGRATION_SENTINEL_FILENAME);
}

/**
 * Node-id whitelist. Rejects path traversal, separators, and shell-style
 * special chars. Matches the generator in renderer (`node-<ts>-<n>`) and
 * future genId variants while staying conservative.
 */
const SAFE_NODE_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export function isSafeNodeId(id: string): boolean {
  return SAFE_NODE_ID.test(id) && id !== '.' && id !== '..';
}

export function assertSafeNodeId(id: string): void {
  if (!isSafeNodeId(id)) {
    throw new Error(`[canvas-storage] refusing unsafe node id: ${JSON.stringify(id)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Atomic I/O

function isEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}

/**
 * Atomically write JSON to disk via tmp + rename.
 *
 * `rename()` is the only safe way to publish a new file: `fs.writeFile` is
 * NOT atomic (truncate-then-stream), so a crash or a concurrent reader can
 * see an empty/partial file. With multiple writers racing on the same file
 * (canvas-workspace + canvas-cli + canvas-agent + MCP server, all on the
 * same workspace) this is a real data-loss path.
 *
 * If `rollingBackup` is true, the current contents are copied to
 * `<path>.bak` *before* overwrite — but only when the current file parses
 * and looks non-empty. That prevents a single corrupt write from
 * poisoning the rolling backup.
 */
export async function atomicWriteJson(
  finalPath: string,
  serialized: string,
  opts: { rollingBackup?: boolean } = {},
): Promise<void> {
  const dir = dirname(finalPath);
  const base = basename(finalPath);
  const tmpPath = join(dir, `${base}.tmp`);
  const bakPath = join(dir, `${base}.bak`);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, serialized, 'utf-8');

  if (opts.rollingBackup) {
    try {
      const currentRaw = await fs.readFile(finalPath, 'utf-8');
      try {
        const current = JSON.parse(currentRaw) as { nodes?: unknown[] };
        // Only rotate when the current file is a *good* snapshot. Don't let
        // a corrupt save poison the last-known-good backup.
        if (Array.isArray(current.nodes) && current.nodes.length > 0) {
          await fs.copyFile(finalPath, bakPath).catch(() => undefined);
        }
      } catch {
        // Current file unparseable — keep existing .bak intact.
      }
    } catch {
      // No current file (first write) — nothing to back up.
    }
  }

  await fs.rename(tmpPath, finalPath);
}

/**
 * Result of a recovery-aware JSON read.
 *  - ok:           parsed cleanly (from primary or backup).
 *  - missing:      neither file exists; caller treats as fresh.
 *  - unrecoverable: primary failed AND backup failed; caller must surface.
 */
export type ReadJsonResult<T = unknown> =
  | { kind: 'ok'; data: T; recoveredFromBackup: boolean }
  | { kind: 'missing' }
  | { kind: 'unrecoverable'; err: unknown };

/**
 * Read JSON with transparent fallback to `<path>.bak`. Used for `canvas.json`
 * so that even an older, pre-atomic-write corruption can self-heal on the
 * next load.
 */
export async function readJsonWithRecovery<T = unknown>(
  finalPath: string,
): Promise<ReadJsonResult<T>> {
  const bakPath = `${finalPath}.bak`;
  let primaryErr: unknown = null;

  try {
    const raw = await fs.readFile(finalPath, 'utf-8');
    try {
      return { kind: 'ok', data: JSON.parse(raw) as T, recoveredFromBackup: false };
    } catch (err) {
      primaryErr = err;
    }
  } catch (err) {
    if (isEnoent(err)) {
      // Fall through to backup; if also missing, return `missing`.
    } else {
      primaryErr = err;
    }
  }

  try {
    const bakRaw = await fs.readFile(bakPath, 'utf-8');
    return {
      kind: 'ok',
      data: JSON.parse(bakRaw) as T,
      recoveredFromBackup: true,
    };
  } catch (bakErr) {
    if (isEnoent(bakErr)) {
      return primaryErr
        ? { kind: 'unrecoverable', err: primaryErr }
        : { kind: 'missing' };
    }
    return { kind: 'unrecoverable', err: primaryErr ?? bakErr };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Schema detection

/**
 * Detect on-disk schema version. v1 is identified by `schemaVersion` either
 * absent, undefined, or strictly `1`. Anything else with `nodes` is treated
 * as v1 too (forward-tolerant: an unknown future version we can still read
 * by ignoring extra fields).
 */
export function detectSchemaVersion(parsed: unknown): SchemaVersion {
  if (parsed && typeof parsed === 'object') {
    const v = (parsed as { schemaVersion?: unknown }).schemaVersion;
    if (v === 2) return 2;
  }
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sentinel

export async function readSentinel(
  workspaceId: string,
  root: string = STORE_DIR,
): Promise<MigrationSentinel | null> {
  try {
    const raw = await fs.readFile(getSentinelPath(workspaceId, root), 'utf-8');
    return JSON.parse(raw) as MigrationSentinel;
  } catch (err) {
    if (isEnoent(err)) return null;
    // Sentinel exists but is unparseable — treat as present-but-opaque so
    // recovery still runs; return a minimal placeholder.
    return { startedAt: 0, workspaceId, sourceUpdatedAt: null, expectedNodeIds: [] };
  }
}

export async function writeSentinel(
  workspaceId: string,
  sentinel: MigrationSentinel,
  root: string = STORE_DIR,
): Promise<void> {
  await atomicWriteJson(
    getSentinelPath(workspaceId, root),
    JSON.stringify(sentinel, null, 2),
  );
}

export async function deleteSentinel(
  workspaceId: string,
  root: string = STORE_DIR,
): Promise<void> {
  await fs.unlink(getSentinelPath(workspaceId, root)).catch(() => undefined);
}

/**
 * In-process set of workspace ids whose migration is currently in
 * flight. Used to suppress recovery cleanup when another reader in the
 * same process catches the sentinel mid-migration — that's not a "crash
 * leftover", it's a live operation we'd be racing.
 *
 * Cross-process safety: this only covers concurrent callers in *this*
 * Node process (typically the Electron main process). canvas-cli is a
 * separate process and doesn't run recovery at all, so it never races
 * here either.
 */
const activeMigrations = new Set<string>();

export function markMigrationActive(workspaceId: string): void {
  activeMigrations.add(workspaceId);
}

export function clearMigrationActive(workspaceId: string): void {
  activeMigrations.delete(workspaceId);
}

export function isMigrationActive(workspaceId: string): boolean {
  return activeMigrations.has(workspaceId);
}

/**
 * If a `.migrating` sentinel is present from a previous interrupted migration,
 * clean up so the next `readCanvasFull` lands in a sane state. Three cases:
 *
 *  - canvas.json is v1 (commit point not yet reached): delete partial
 *    per-node files listed in the sentinel, drop the sentinel. Workspace
 *    stays v1; lazy migrate retries on demand.
 *  - canvas.json is v2 (commit point passed; only the sentinel removal
 *    failed): leave per-node files in place, drop the sentinel.
 *  - canvas.json unparseable (rename collision, extremely rare): restore
 *    from `canvas.json.v1.bak`, clean per-node files, drop the sentinel.
 *
 * Skipped when an in-process migration is currently in flight for the
 * workspace — that's a live operation, not a crash leftover.
 *
 * Returns `true` iff a sentinel was found (caller may log).
 */
export async function recoverInterruptedMigration(
  workspaceId: string,
  root: string = STORE_DIR,
): Promise<boolean> {
  if (isMigrationActive(workspaceId)) return false;
  const sentinel = await readSentinel(workspaceId, root);
  if (!sentinel) return false;

  const canvasPath = getCanvasJsonPath(workspaceId, root);
  const readResult = await readJsonWithRecovery(canvasPath);

  if (readResult.kind === 'ok') {
    const version = detectSchemaVersion(readResult.data);
    if (version === 2) {
      // Commit point passed before crash; nodes/*.json are complete.
      await deleteSentinel(workspaceId, root);
      return true;
    }
    // canvas.json is still v1 → crash happened pre-commit. Wipe partial work.
    await cleanupPartialNodeFiles(workspaceId, sentinel.expectedNodeIds, root);
    await deleteSentinel(workspaceId, root);
    return true;
  }

  if (readResult.kind === 'missing') {
    // canvas.json vanished mid-migration. The v1 backup is the source of
    // truth; restore it so the next read is sane.
    await restoreFromV1Backup(workspaceId, root);
    await cleanupPartialNodeFiles(workspaceId, sentinel.expectedNodeIds, root);
    await deleteSentinel(workspaceId, root);
    return true;
  }

  // Unrecoverable read: try v1 backup, otherwise leave the sentinel so the
  // user gets a loud failure rather than a silent half-state.
  const restored = await restoreFromV1Backup(workspaceId, root);
  if (restored) {
    await cleanupPartialNodeFiles(workspaceId, sentinel.expectedNodeIds, root);
    await deleteSentinel(workspaceId, root);
  }
  return true;
}

async function restoreFromV1Backup(
  workspaceId: string,
  root: string = STORE_DIR,
): Promise<boolean> {
  const bakPath = getV1BackupPath(workspaceId, root);
  try {
    const raw = await fs.readFile(bakPath, 'utf-8');
    // Validate it parses before publishing — we don't want to swap one
    // unreadable file for another.
    JSON.parse(raw);
    await atomicWriteJson(getCanvasJsonPath(workspaceId, root), raw);
    return true;
  } catch {
    return false;
  }
}

async function cleanupPartialNodeFiles(
  workspaceId: string,
  expectedNodeIds: string[],
  root: string = STORE_DIR,
): Promise<void> {
  for (const id of expectedNodeIds) {
    if (!isSafeNodeId(id)) continue;
    await fs.unlink(getNodeFilePath(workspaceId, id, root)).catch(() => undefined);
  }
}

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
  if (!isSafeNodeId(nodeId)) return null;
  try {
    const raw = await fs.readFile(getNodeFilePath(workspaceId, nodeId, root), 'utf-8');
    return JSON.parse(raw) as PerNodeFile;
  } catch (err) {
    if (isEnoent(err)) return null;
    console.warn(
      `[canvas-storage] unreadable per-node file ${nodeId} in ${workspaceId}: ${String(err)}`,
    );
    return null;
  }
}

/** Atomically write a per-node file. No rolling backup — these are small and replaceable. */
export async function writeNodeFile(
  workspaceId: string,
  file: PerNodeFile,
  root: string = STORE_DIR,
): Promise<void> {
  assertSafeNodeId(file.id);
  const path = getNodeFilePath(workspaceId, file.id, root);
  await atomicWriteJson(path, JSON.stringify(file, null, 2));
}

export async function deleteNodeFile(
  workspaceId: string,
  nodeId: string,
  root: string = STORE_DIR,
): Promise<void> {
  if (!isSafeNodeId(nodeId)) return;
  await fs.unlink(getNodeFilePath(workspaceId, nodeId, root)).catch(() => undefined);
}

/** List `<nodeId>` for every parseable per-node file in the workspace. */
export async function listNodeFiles(
  workspaceId: string,
  root: string = STORE_DIR,
): Promise<string[]> {
  const dir = getNodesDir(workspaceId, root);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  const out: string[] = [];
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -'.json'.length);
    if (isSafeNodeId(id)) out.push(id);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Full read / write

export interface ReadCanvasResult {
  /** Full v1-shape data ready for callers; null if no canvas.json exists. */
  data: CanvasSaveData | null;
  /** True if the primary canvas.json was unreadable and `.bak` was used. */
  recoveredFromBackup: boolean;
  /** On-disk schema; null when the workspace has no canvas.json at all. */
  schemaVersion: SchemaVersion | null;
}

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
 * version is currently on disk.
 *
 * In PR1 every workspace is still v1, so this just writes the whole shape
 * to canvas.json atomically — identical behavior to the legacy code. Once
 * PR3 flips on v2, this same call splits the input into layout + per-node
 * files automatically; callers (`canvas:save`, MCP server, etc.) need no
 * code change to follow along.
 */
export async function writeCanvasFull(
  workspaceId: string,
  data: CanvasSaveData,
  root: string = STORE_DIR,
): Promise<void> {
  const canvasPath = getCanvasJsonPath(workspaceId, root);
  await fs.mkdir(dirname(canvasPath), { recursive: true });

  // Detect current on-disk version. Fresh workspace → default to v1 to
  // keep PR1 behaviorally identical; PR3 changes this default to v2.
  const existing = await readJsonWithRecovery<CanvasSaveData>(canvasPath);
  const currentVersion: SchemaVersion =
    existing.kind === 'ok' ? detectSchemaVersion(existing.data) : 1;

  if (currentVersion === 1) {
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
  const incomingIds = new Set<string>();

  // 1. Write per-node files for every node. Use updatedAt arbitration: if
  //    the on-disk per-node file is newer, keep it (defends against a stale
  //    in-memory snapshot clobbering a fresh CLI-side edit).
  for (const node of nodes) {
    if (!node.id || !isSafeNodeId(node.id)) continue;
    incomingIds.add(node.id);

    const existing = await readNodeFile(workspaceId, node.id, root);
    const incomingUpdatedAt =
      typeof node.updatedAt === 'number' ? node.updatedAt : now;
    const existingUpdatedAt =
      existing && typeof existing.updatedAt === 'number'
        ? existing.updatedAt
        : 0;

    if (existing && existingUpdatedAt > incomingUpdatedAt) {
      // Disk is newer — preserve it.
      continue;
    }

    const file: PerNodeFile = {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: node.id,
      type: node.type,
      title: node.title,
      data: (node.data ?? {}) as Record<string, unknown>,
      updatedAt: incomingUpdatedAt,
      createdAt: existing?.createdAt ?? incomingUpdatedAt,
    };
    await writeNodeFile(workspaceId, file, root);
  }

  // 2. Delete per-node files for nodes that no longer exist in the incoming
  //    snapshot. (Tombstoning is a future concern; for now, gone-from-input
  //    = gone-from-disk.)
  const onDisk = await listNodeFiles(workspaceId, root);
  for (const id of onDisk) {
    if (!incomingIds.has(id)) {
      await deleteNodeFile(workspaceId, id, root);
    }
  }

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
  const { data: _data, ...rest } = node;
  return rest;
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

    // 2. Permanent v1 archive. Copy the raw bytes (not the parsed value)
    //    to preserve exact byte-level state, including any user-meaningful
    //    formatting in the original file.
    onProgress({ phase: 'backup' });
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
