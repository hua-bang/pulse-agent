import type { Dirent } from "fs";
import { ipcMain, BrowserWindow, dialog } from "electron";
import { promises as fs, watch as fsWatch, FSWatcher } from "fs";
import { join, basename, dirname, relative, resolve, sep, isAbsolute } from "path";
import { homedir } from "os";
import {
  atomicWriteJson,
  readJsonWithRecovery,
  readCanvasFull,
  writeCanvasFull,
  migrateToV2,
  detectSchemaVersion,
  isSafeNodeId,
  getNodesDir,
  getNodeFilePath,
  type MigrationProgress,
  type ReadJsonResult,
} from "./canvas-storage";

const STORE_DIR = join(homedir(), ".pulse-coder", "canvas");
const MANIFEST_ID = '__workspaces__';

/**
 * Atomically write a canvas JSON file with a rolling `.bak` backup.
 *
 * Thin wrapper over `atomicWriteJson` from `canvas-storage.ts`. The shared
 * implementation is the single source of truth for atomic file publishing
 * (tmp + rename + optional rolling backup) — `canvas-store.ts`,
 * `mcp-server.ts`, `canvas-agent/tools.ts`, and `canvas-cli` will all
 * converge on it across PR2/PR3, replacing five near-duplicate copies.
 *
 * Recovery: `canvas:load` falls back to `<path>.bak` when the primary
 * file fails to parse, so even a pre-existing corruption from an older
 * non-atomic write path can self-heal on next load.
 */
const atomicWriteCanvasJson = (
  finalPath: string,
  serialized: string,
): Promise<void> =>
  atomicWriteJson(finalPath, serialized, { rollingBackup: true });

/**
 * Read canvas JSON with transparent fallback to the rolling `.bak` if
 * the primary file is missing or unparseable. Returns the parsed data
 * plus a `recoveredFromBackup` flag so callers can log / re-persist.
 *
 * Thin wrapper over `readJsonWithRecovery` from `canvas-storage.ts`. Kept
 * for the warning log: the shared helper stays silent so it can also be
 * used outside the Electron main process.
 */
const readCanvasJsonWithRecovery = async (
  finalPath: string,
): Promise<ReadJsonResult> => {
  const result = await readJsonWithRecovery(finalPath);
  if (result.kind === 'ok' && result.recoveredFromBackup) {
    console.warn(
      `[canvas-store] primary canvas.json unreadable; recovered from ${basename(`${finalPath}.bak`)}`,
    );
  }
  return result;
};

const AGENTS_MD_TEMPLATE = `# Canvas Agent Config

## Purpose
<!-- Describe what this workspace is for -->

## Instructions
<!-- Conventions, style, or constraints for agents working in this workspace -->

---

<!-- canvas:auto-start -->
<!-- canvas:auto-end -->
`;


const EXPORT_FORMAT = 'pulse-canvas-workspace';
const EXPORT_VERSION = 1;
const PORTABLE_WORKSPACE_URL_PREFIX = 'pulsecanvas://workspace/';

interface WorkspaceExportFile {
  relativePath: string;
  encoding: 'base64';
  content: string;
}

interface WorkspaceExportPayload {
  format: typeof EXPORT_FORMAT;
  version: typeof EXPORT_VERSION;
  exportedAt: string;
  workspace: {
    id: string;
    name: string;
  };
  canvas: unknown;
  files: WorkspaceExportFile[];
}

const sanitizeFileName = (name: string): string => {
  const safe = name.replace(/[^a-zA-Z0-9_\- .]/g, '').trim();
  return safe || 'workspace';
};

const toPortableRelativePath = (filePath: string, workspaceDir: string): string | null => {
  const rel = relative(workspaceDir, filePath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
};

const portableUrlForRelativePath = (relativePath: string): string =>
  `${PORTABLE_WORKSPACE_URL_PREFIX}${encodeURI(relativePath)}`;

const relativePathFromPortableUrl = (value: string): string | null => {
  if (!value.startsWith(PORTABLE_WORKSPACE_URL_PREFIX)) return null;
  return decodeURI(value.slice(PORTABLE_WORKSPACE_URL_PREFIX.length));
};

const isSafeRelativePath = (relativePath: string): boolean => {
  if (!relativePath || isAbsolute(relativePath)) return false;
  const normalized = relativePath.replace(/\\/g, '/');
  return !normalized.split('/').some((part) => part === '..' || part === '');
};

const rewriteCanvasFilePaths = (
  value: unknown,
  mapper: (filePath: string) => string,
): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteCanvasFilePaths(item, mapper));
  }
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === 'filePath' && typeof item === 'string') {
      out[key] = mapper(item);
    } else {
      out[key] = rewriteCanvasFilePaths(item, mapper);
    }
  }
  return out;
};

const collectWorkspaceFiles = async (workspaceDir: string): Promise<WorkspaceExportFile[]> => {
  const files: WorkspaceExportFile[] = [];

  const walk = async (dir: string): Promise<void> => {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      throw err;
    }

    for (const entry of entries) {
      if (entry.name === 'canvas.json' || entry.name === 'canvas.json.bak' || entry.name === 'canvas.json.tmp') {
        continue;
      }
      const fullPath = join(dir, entry.name);
      const relativePath = toPortableRelativePath(fullPath, workspaceDir);
      if (!relativePath || !isSafeRelativePath(relativePath)) continue;
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const buffer = await fs.readFile(fullPath);
      files.push({ relativePath, encoding: 'base64', content: buffer.toString('base64') });
    }
  };

  await walk(workspaceDir);
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return files;
};

const readWorkspaceCanvasForExport = async (workspaceId: string): Promise<unknown> => {
  await migrateIfNeeded(workspaceId);
  await ensureWorkspaceDir(workspaceId);
  const filePath = getFilePath(workspaceId);
  const readResult = await readCanvasJsonWithRecovery(filePath);
  if (readResult.kind === 'missing') return null;
  if (readResult.kind === 'unrecoverable') throw readResult.err;
  const data = readResult.data as CanvasSaveData;
  const dirty = await migrateNotePaths(workspaceId, data);
  if (dirty || readResult.recoveredFromBackup) {
    await atomicWriteCanvasJson(filePath, JSON.stringify(data, null, 2));
  }
  return data;
};

const createUniqueImportedWorkspaceId = async (): Promise<string> => {
  for (let i = 0; i < 100; i += 1) {
    const id = `ws-imported-${Date.now()}${i ? `-${i}` : ''}`;
    try {
      await fs.access(getWorkspaceDir(id));
    } catch {
      return id;
    }
  }
  return `ws-imported-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const parseWorkspaceExportPayload = (raw: string): WorkspaceExportPayload => {
  const parsed = JSON.parse(raw) as Partial<WorkspaceExportPayload>;
  if (parsed.format !== EXPORT_FORMAT) {
    throw new Error('Selected file is not a Pulse Canvas workspace export.');
  }
  if (parsed.version !== EXPORT_VERSION) {
    throw new Error(`Unsupported Pulse Canvas export version: ${String(parsed.version)}`);
  }
  if (!parsed.workspace || typeof parsed.workspace.name !== 'string') {
    throw new Error('Workspace export is missing workspace metadata.');
  }
  if (!Array.isArray(parsed.files)) {
    throw new Error('Workspace export is missing file payloads.');
  }
  for (const file of parsed.files) {
    if (!file || typeof file.relativePath !== 'string' || file.encoding !== 'base64' || typeof file.content !== 'string') {
      throw new Error('Workspace export contains an invalid file entry.');
    }
    if (!isSafeRelativePath(file.relativePath)) {
      throw new Error(`Workspace export contains an unsafe file path: ${file.relativePath}`);
    }
  }
  return parsed as WorkspaceExportPayload;
};

/** Manifest stays as a flat file; all other workspaces live in subdirectories. */
const getFilePath = (id: string): string => {
  if (id === MANIFEST_ID) {
    return join(STORE_DIR, `${MANIFEST_ID}.json`);
  }
  return join(STORE_DIR, id, 'canvas.json');
};

export const getWorkspaceDir = (id: string): string =>
  join(STORE_DIR, id);

/** Migrate old flat `{id}.json` → `{id}/canvas.json` if needed. */
const migrateIfNeeded = async (id: string): Promise<void> => {
  const newPath = getFilePath(id);
  const oldPath = join(STORE_DIR, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
  try {
    await fs.access(newPath);
    return; // already in new format
  } catch {
    // new path missing — check for old flat file
  }
  let raw: string;
  try {
    raw = await fs.readFile(oldPath, 'utf-8');
  } catch {
    // no old file either — fresh workspace, nothing to migrate
    return;
  }
  // Validate the legacy file parses before propagating it. A non-atomic
  // copy of unparseable bytes would just move the corruption into the
  // new canonical path, where loaders would then trip on it forever.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(
      `[canvas-store] refusing to migrate unparseable legacy canvas for ${id} ` +
      `at ${oldPath}: ${err instanceof Error ? err.message : String(err)}. ` +
      `Leaving the legacy file in place.`,
    );
    return;
  }
  await fs.mkdir(getWorkspaceDir(id), { recursive: true });
  // Use the same atomic helper as every other writer so a crash mid-
  // migration cannot leave a partial canvas.json at the new path.
  await atomicWriteCanvasJson(newPath, JSON.stringify(parsed, null, 2));
  await fs.unlink(oldPath).catch(() => undefined);
};

/** Ensure workspace directory exists and seed AGENTS.md if absent. */
const ensureWorkspaceDir = async (id: string): Promise<void> => {
  const dir = getWorkspaceDir(id);
  await fs.mkdir(dir, { recursive: true });
  const agentsPath = join(dir, 'AGENTS.md');
  const hasAgents = await fs.access(agentsPath).then(() => true).catch(() => false);
  if (!hasAgents) {
    await fs.writeFile(agentsPath, AGENTS_MD_TEMPLATE, 'utf-8');
  }
};

/** Old global notes directory (pre-refactor). */
const LEGACY_NOTES_DIR = join(STORE_DIR, 'notes');

interface CanvasNode {
  id?: string;
  type: string;
  data?: { filePath?: string; [k: string]: unknown };
  updatedAt?: number;
  [k: string]: unknown;
}

interface CanvasSaveData {
  nodes?: CanvasNode[];
  [k: string]: unknown;
}

/**
 * Migrate file-node paths that still point to the old global notes dir
 * into the per-workspace notes dir. Moves the actual files on disk and
 * returns true when the data was modified (caller should re-save).
 */
const migrateNotePaths = async (
  id: string,
  data: CanvasSaveData,
): Promise<boolean> => {
  if (!Array.isArray(data.nodes)) return false;
  const newNotesDir = join(STORE_DIR, id, 'notes');
  let dirty = false;
  for (const node of data.nodes) {
    if (node.type !== 'file' || !node.data?.filePath) continue;
    const fp: string = node.data.filePath;
    if (!fp.startsWith(LEGACY_NOTES_DIR + '/') && !fp.startsWith(LEGACY_NOTES_DIR + '\\')) continue;
    const fileName = fp.split(/[\\/]/).pop()!;
    const newPath = join(newNotesDir, fileName);
    try {
      await fs.mkdir(newNotesDir, { recursive: true });
      await fs.copyFile(fp, newPath);
      await fs.unlink(fp).catch(() => undefined);
    } catch {
      // file may already be missing; still update the stored path
    }
    node.data = { ...node.data, filePath: newPath };
    dirty = true;
  }
  return dirty;
};

/**
 * Track node IDs that Electron has seen (loaded or merged in) per workspace.
 * This lets us distinguish "CLI added a new node" (ID never seen before)
 * from "user deleted a node" (ID was seen, now missing from memory).
 */
const knownNodeIds = new Map<string, Set<string>>();

/**
 * Merge external changes (e.g. from canvas-cli) into the data being saved.
 *
 * Two merge rules are applied, in order:
 *
 *   1. Per-node "newer wins" by `updatedAt`: if a node exists in both the
 *      in-memory snapshot and the on-disk snapshot, the one with the greater
 *      `updatedAt` wins. This protects canvas-cli writes from being clobbered
 *      by stale renderer saves (e.g. the terminal scrollback autosave timer
 *      firing right after the CLI updated a file node).
 *
 *   2. Add disk-only nodes whose IDs have NEVER been seen by Electron. This
 *      is how canvas-cli creates show up. Disk-only nodes whose IDs *are*
 *      known were deleted in the UI and must not be re-added.
 */
const isEnoent = (err: unknown): boolean =>
  !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';

/**
 * Sentinel returned by `mergeExternalNodes` when we can't verify the
 * on-disk canvas AND the renderer is asking us to write an empty one.
 * The save handler treats this as a silent skip instead of a failed save
 * so the tried-and-true "refuse to clobber" guard doesn't surface as an
 * unhandledRejection when the outer lock chain hasn't attached a catch yet.
 */
const SKIP_WRITE = Symbol('canvas-store:skip-write');
type MergeResult = CanvasSaveData | typeof SKIP_WRITE;

type DiskReadOutcome =
  | { kind: 'ok'; nodes: CanvasNode[] }
  | { kind: 'missing' }
  | { kind: 'unparseable'; err: unknown }
  | { kind: 'ioerror'; err: unknown };

/**
 * Read and parse the workspace's canvas.json, retrying a few times when
 * the read lands on an in-progress write from canvas-cli or another
 * writer. A truncated/half-written file surfaces as a JSON.parse error
 * (typically "Unexpected end of JSON input"); a brief backoff almost
 * always catches the completed write on the next attempt.
 */
const readDiskCanvas = async (
  id: string,
  attempts = 3,
  delayMs = 30,
): Promise<DiskReadOutcome> => {
  let lastErr: unknown = null;
  for (let i = 0; i < attempts; i++) {
    try {
      // `readCanvasFull` always returns v1-shape regardless of on-disk
      // schema: for v2 workspaces it reads `canvas.json` (layout) plus
      // `nodes/<id>.json` and assembles them back into inline `data`.
      // The merge logic below works on v1-shape and doesn't need to
      // know about v2 storage details.
      const result = await readCanvasFull(id);
      if (result.data === null) return { kind: 'missing' };
      const nodes = Array.isArray(result.data.nodes) ? (result.data.nodes as CanvasNode[]) : [];
      return { kind: 'ok', nodes };
    } catch (err) {
      // Parse failure almost always means we caught another writer
      // (canvas-cli mid-flush). A brief backoff almost always lands on
      // the completed write.
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  return { kind: 'unparseable', err: lastErr };
};

/**
 * Broadcast a migration progress event to every renderer window. Powers
 * the MigrationSpinner UI (which only surfaces after a 1s delay, so
 * sub-second migrations stay invisible).
 */
const broadcastMigrationProgress = (
  workspaceId: string,
  progress: MigrationProgress,
): void => {
  const payload = {
    workspaceId,
    phase: progress.phase,
    current: progress.current,
    total: progress.total,
    message: progress.message,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('canvas:migration-progress', payload);
  }
};

/**
 * If a workspace is still on the v1 storage format, migrate it to v2.
 *
 * This is the single trigger point for lazy auto-migration. Called from
 * both `canvas:load` and `canvas:save` IPC handlers so the migration
 * happens silently whenever the user first interacts with a workspace.
 * Other consumers (mcp-server, canvas-agent, artifact-ipc, canvas-cli)
 * do NOT trigger migration — they observe whatever schema exists on
 * disk and adapt via the shared helper.
 *
 * Held inside `withSaveLock` so concurrent saves serialize through it.
 * Cheap when the workspace is already v2: a single canvas.json peek
 * before taking the lock skips the entire lock round-trip.
 *
 * On any error: we log and proceed. The save/load handler then continues
 * with whatever state is on disk — worst case it's still v1 and the next
 * call retries. We deliberately do not fail the user-facing operation
 * over a migration hiccup.
 */
const ensureMigrated = async (workspaceId: string): Promise<void> => {
  if (workspaceId === MANIFEST_ID) return;

  // Cheap pre-check: peek canvas.json, return early when already v2.
  const peekPath = getFilePath(workspaceId);
  try {
    const raw = await fs.readFile(peekPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (detectSchemaVersion(parsed) === 2) return;
  } catch (err) {
    if (isEnoent(err)) return; // fresh workspace, nothing to migrate
    // Parse failure — fall through; recoverInterruptedMigration inside
    // `readCanvasFull` will sort it out, or migration will throw and we
    // surface that on the next interaction.
  }

  await withSaveLock(workspaceId, async () => {
    // Re-check inside the lock — another save may have migrated already.
    try {
      const raw = await fs.readFile(peekPath, 'utf-8');
      if (detectSchemaVersion(JSON.parse(raw)) === 2) return;
    } catch (err) {
      if (isEnoent(err)) return;
      // Same fall-through as above.
    }
    try {
      await migrateToV2(workspaceId, {
        onProgress: (p) => broadcastMigrationProgress(workspaceId, p),
      });
    } catch (err) {
      console.warn(
        `[canvas-store] migration to v2 failed for ${workspaceId}: ${String(err)}; leaving workspace on v1 until next interaction`,
      );
      broadcastMigrationProgress(workspaceId, {
        phase: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });
};

const mergeExternalNodes = async (
  id: string,
  inMemoryData: CanvasSaveData,
): Promise<MergeResult> => {
  const known = knownNodeIds.get(id) ?? new Set<string>();
  const memoryNodes = Array.isArray(inMemoryData.nodes) ? inMemoryData.nodes : [];

  const disk = await readDiskCanvas(id);

  if (disk.kind === 'missing') {
    // Fresh canvas on disk — nothing to merge against; in-memory wins.
    return inMemoryData;
  }

  if (disk.kind === 'ioerror' || disk.kind === 'unparseable') {
    // Transient read failure or caught another writer mid-flush (even
    // after retries). If memory is empty, we can't verify the disk is
    // also empty — skip the write rather than risk clobbering real data.
    // Memory-has-data case falls back to the memory snapshot; the save
    // handler's second-pass merge narrows the race further.
    if (memoryNodes.length === 0) {
      const reason =
        disk.kind === 'unparseable'
          ? 'canvas.json was unparseable (likely mid-flush)'
          : 'canvas.json read failed';
      console.warn(
        `[canvas-store] skipping empty write for ${id}: ${reason} — ${String(disk.err)}`,
      );
      return SKIP_WRITE;
    }
    return inMemoryData;
  }

  const diskNodes = disk.nodes;

  // Hard safety: never let a save with an empty node list clobber a
  // non-empty on-disk canvas. This shields against early-lifecycle
  // flushSave calls that fire before the renderer has finished loading
  // (e.g. on window close / StrictMode double-invoke / HMR reload),
  // which would otherwise wipe the canvas because every disk id is
  // already in the `known` set.
  if (memoryNodes.length === 0 && diskNodes.length > 0) {
    console.warn(
      `[canvas-store] refusing to overwrite ${diskNodes.length} on-disk nodes with empty memory for ${id}`,
    );
    return { ...inMemoryData, nodes: diskNodes };
  }

  const diskById = new Map<string, CanvasNode>();
  for (const n of diskNodes) {
    if (n.id) diskById.set(n.id, n);
  }

  // Rule 1: reconcile nodes that are in memory.
  //   - Both disk and memory have it → pick the newer `updatedAt`.
  //     A memory node without updatedAt is treated as "older than any
  //     timestamped disk version" — the common case where the CLI
  //     just wrote the disk copy with a timestamp.
  //   - Only memory has it:
  //       * id is in `known` → CLI deleted it between the renderer's
  //         last load and this save. Drop it so the save doesn't
  //         resurrect the deletion.
  //       * id is not in `known` → user just created it in memory
  //         and this is the first save that will persist it. Keep.
  const mergedExisting: CanvasNode[] = [];
  for (const memNode of memoryNodes) {
    if (!memNode.id) {
      mergedExisting.push(memNode);
      continue;
    }
    const diskNode = diskById.get(memNode.id);
    if (!diskNode) {
      if (known.has(memNode.id)) {
        // CLI-deleted; drop.
        continue;
      }
      mergedExisting.push(memNode);
      continue;
    }
    const memTs = typeof memNode.updatedAt === 'number' ? memNode.updatedAt : 0;
    const diskTs = typeof diskNode.updatedAt === 'number' ? diskNode.updatedAt : 0;
    mergedExisting.push(diskTs > memTs ? diskNode : memNode);
  }

  // Rule 2: nodes only on disk and never-seen → CLI creates, add them.
  const memoryIds = new Set(memoryNodes.map((n) => n.id).filter(Boolean) as string[]);
  const externalNewNodes = diskNodes.filter(
    (n) => n.id && !memoryIds.has(n.id) && !known.has(n.id),
  );

  // Rule 3 (partial-memory safety net): if the renderer's memory snapshot
  // is suspiciously smaller than what we've already persisted, refuse to
  // drop the missing-from-memory disk nodes. This catches the wipe path
  // where Rule 1 treats every disk-known-but-memory-absent id as a
  // "user delete" — legitimate when memory is a complete snapshot, but
  // catastrophic when memory is a partial/half-loaded snapshot (React
  // StrictMode double-mount, HMR, beforeunload fired mid-load, an
  // unmount during a state update, etc).
  //
  // Heuristic: only trigger when a lot of known nodes went missing AND
  // memory is much smaller than disk. This stays conservative so ordinary
  // "user deleted a couple of nodes" saves still propagate the deletion.
  const missingKnownDiskNodes = diskNodes.filter(
    (n) => !!n.id && known.has(n.id) && !memoryIds.has(n.id),
  );
  const knownDiskCount = diskNodes.reduce(
    (count, n) => (n.id && known.has(n.id) ? count + 1 : count),
    0,
  );
  const suspiciousShrink =
    missingKnownDiskNodes.length >= 5 &&
    knownDiskCount > 0 &&
    missingKnownDiskNodes.length / knownDiskCount >= 0.5 &&
    memoryNodes.length < missingKnownDiskNodes.length;

  let preservedMissing: CanvasNode[] = [];
  if (suspiciousShrink) {
    console.warn(
      `[canvas-store] suspicious shrink for ${id}: memory has ${memoryNodes.length} nodes ` +
      `but ${missingKnownDiskNodes.length}/${knownDiskCount} previously-persisted disk nodes are absent. ` +
      `Preserving them in case this is a partial snapshot (load race / HMR / double-mount).`,
    );
    preservedMissing = missingKnownDiskNodes;
  }

  // NOTE: we intentionally do NOT mutate `knownNodeIds` here. The save
  // handler calls `mergeExternalNodes` twice back-to-back (to narrow a
  // race with concurrent canvas-cli writes). If this function added
  // freshly-merged ids to `known` on the first call, the second call
  // would then see the in-memory new node's id as "known" but still
  // absent from disk — and Rule 1's "CLI deleted; drop" branch would
  // silently strip the node the user just created. The save handler
  // is responsible for updating `knownNodeIds` once, after writeFile.

  return {
    ...inMemoryData,
    nodes: [...mergedExisting, ...externalNewNodes, ...preservedMissing],
  };
};

/**
 * Per-workspace save lock. Serializes concurrent `canvas:save` invocations
 * for the same workspace so the read-merge-write sequence in each call
 * cannot interleave with itself. This does NOT protect against external
 * writers (canvas-cli); for that, `mergeExternalNodes` is called twice —
 * once up front and again immediately before `writeFile`.
 */
const saveLocks = new Map<string, Promise<unknown>>();

const withSaveLock = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
  const prev = saveLocks.get(id) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const tracked = next.finally(() => {
    if (saveLocks.get(id) === tracked) saveLocks.delete(id);
  });
  // The chain promise stored in `saveLocks` only exists to sequence the
  // NEXT save via `prev.then(fn, fn)`. If `fn` rejects and no subsequent
  // save arrives before the microtask queue checks, `tracked` would
  // surface as an unhandledRejection. The caller still sees the real
  // error via `next`; swallow it here.
  tracked.catch(() => undefined);
  saveLocks.set(id, tracked);
  return next;
};

/**
 * File-system-based external-update bus.
 *
 * Previous designs used a Unix domain socket and later a loopback TCP
 * listener to let canvas-cli notify Electron of mutations. Both are
 * denied by the macOS Seatbelt profile that CLI agents like Codex wrap
 * their child processes in (`network-outbound` is limited to outgoing
 * DNS/HTTPS; AF_UNIX connect and AF_INET connect to 127.0.0.1 both
 * return EPERM). The only remaining channel the sandboxed CLI reliably
 * has is the filesystem, which it already uses to persist the canvas.
 *
 * So we invert the model: the CLI just writes `canvas.json`, and the
 * Electron main process watches that file. When its contents change
 * for any reason other than our own save handler having just written
 * the same content, we re-read it, diff against the last snapshot the
 * main process knew about, and broadcast the changed node IDs to every
 * renderer via the existing `canvas:external-update` IPC channel.
 *
 * Echo suppression: `canvas:save` updates `lastSnapshot` synchronously
 * after its own `writeFile`, so when the watcher fires (async, 100ms
 * debounced) for the renderer's own write, the disk content and the
 * snapshot are identical, the diff is empty, and nothing is broadcast.
 */
const watchers = new Map<string, FSWatcher>();
const watcherDebounce = new Map<string, NodeJS.Timeout>();
const lastSnapshot = new Map<string, Map<string, CanvasNode>>();

const nodesToMap = (nodes: CanvasNode[] | undefined): Map<string, CanvasNode> => {
  const m = new Map<string, CanvasNode>();
  if (!nodes) return m;
  for (const n of nodes) if (n.id) m.set(n.id, n);
  return m;
};

/**
 * Read whatever canvas.json holds on disk RIGHT NOW, in its on-disk shape:
 *   - v1 workspaces: nodes carry inline `data`.
 *   - v2 workspaces: nodes are layout-only (no `data` field).
 *
 * Used to seed `lastSnapshot` so the `fs.watch` echo-suppression diff is
 * apples-to-apples. The watcher handler reads canvas.json the same way,
 * so a snapshot in any other shape would falsely report every node as
 * changed on every save.
 */
const readOnDiskNodeMap = async (
  workspaceId: string,
): Promise<Map<string, CanvasNode>> => {
  try {
    const raw = await fs.readFile(getFilePath(workspaceId), 'utf-8');
    const parsed = JSON.parse(raw) as CanvasSaveData;
    return nodesToMap(parsed.nodes);
  } catch {
    // Missing or unparseable: treat as empty so the next watcher fire
    // (with a parseable file) registers every node as "new" and broadcasts.
    return new Map<string, CanvasNode>();
  }
};

const diffSnapshots = (
  before: Map<string, CanvasNode>,
  after: Map<string, CanvasNode>,
): string[] => {
  const ids = new Set<string>();
  for (const [id, node] of after) {
    const prev = before.get(id);
    if (!prev) { ids.add(id); continue; }
    // Cheap timestamp check first, fall back to structural equality so
    // we also catch updates that forgot to bump updatedAt.
    if ((prev.updatedAt ?? 0) !== (node.updatedAt ?? 0)) {
      ids.add(id);
    } else if (JSON.stringify(prev) !== JSON.stringify(node)) {
      ids.add(id);
    }
  }
  for (const id of before.keys()) {
    if (!after.has(id)) ids.add(id);
  }
  return Array.from(ids);
};

const broadcastExternalUpdate = (workspaceId: string, nodeIds: string[]) => {
  const payload = {
    type: 'canvas:updated' as const,
    workspaceId,
    nodeIds,
    source: 'fs-watch' as const,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('canvas:external-update', payload);
  }
};

const handleWatcherFire = async (workspaceId: string): Promise<void> => {
  const filePath = getFilePath(workspaceId);
  let data: CanvasSaveData;
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    data = JSON.parse(raw);
  } catch {
    // Partial write or transient read failure — the next event will
    // catch the final state.
    return;
  }
  const newMap = nodesToMap(data.nodes);
  const oldMap = lastSnapshot.get(workspaceId) ?? new Map<string, CanvasNode>();
  const changedIds = diffSnapshots(oldMap, newMap);
  if (changedIds.length === 0) return;
  lastSnapshot.set(workspaceId, newMap);
  // Keep knownNodeIds aligned with disk so `mergeExternalNodes` Rule 2
  // (disk-only never-seen → append) doesn't re-add nodes that the
  // watcher has already observed.
  const known = knownNodeIds.get(workspaceId) ?? new Set<string>();
  for (const id of newMap.keys()) known.add(id);
  knownNodeIds.set(workspaceId, known);
  broadcastExternalUpdate(workspaceId, changedIds);
};

const startWorkspaceWatcher = (workspaceId: string): void => {
  if (watchers.has(workspaceId)) return;
  const filePath = getFilePath(workspaceId);
  let watcher: FSWatcher;
  try {
    watcher = fsWatch(filePath, { persistent: false });
  } catch (err) {
    console.warn(`[canvas-store] fs.watch failed for ${workspaceId}:`, err);
    return;
  }
  watcher.on('change', () => {
    const existing = watcherDebounce.get(workspaceId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      watcherDebounce.delete(workspaceId);
      void handleWatcherFire(workspaceId);
    }, 100);
    watcherDebounce.set(workspaceId, t);
  });
  watcher.on('error', (err) => {
    console.warn(`[canvas-store] watcher error for ${workspaceId}:`, err);
  });
  watchers.set(workspaceId, watcher);
};

// ─── Per-node file watcher (v2 workspaces) ──────────────────────────────
//
// In v2 storage, edits to a single node's `data` land in
// `nodes/<id>.json` instead of `canvas.json`. The canvas.json watcher
// above only fires for layout / membership changes; without a separate
// per-node watcher, canvas-cli or canvas-agent edits to per-node data
// would never reach the renderer until the next full canvas:load.
//
// Echo suppression: every save / load updates `lastPerNodeContent` to
// match the on-disk state. The watcher fire compares per-file content
// against that snapshot; if identical (our own write echoing back), we
// suppress. The renderer's external-update handler highlights nodes for
// 2.5s, so unsuppressed echoes would visually flicker on every save.

/** workspaceId → (nodeId → exact file bytes last seen on disk). */
const lastPerNodeContent = new Map<string, Map<string, string>>();
const nodeFileWatchers = new Map<string, FSWatcher>();
/** Debounced (workspaceId → pending event timer). Batches multi-file events. */
const nodeFileDebounce = new Map<string, NodeJS.Timeout>();
/** Accumulator (workspaceId → set of node ids touched since last batch fire). */
const nodeFileBatch = new Map<string, Set<string>>();
/**
 * Recent self-writes — workspaceId → (nodeId → epoch millis of our last write).
 * Watcher events inside {@link SELF_WRITE_WINDOW_MS} of a recorded write are
 * suppressed as our own echoes, independent of byte / field diff. This
 * defends against the race where seedPerNodeContent hasn't refreshed the
 * snapshot yet when the watcher's debounced fire reads the file (most
 * likely for nodes whose data is mutated *after* canvas:load by an async
 * source like an iframe webview's page-title-updated event).
 */
const recentSelfWrites = new Map<string, Map<string, number>>();
const SELF_WRITE_WINDOW_MS = 500;

/**
 * Read every per-node file currently in `nodes/` and refresh the in-memory
 * snapshot used for watcher echo suppression. Called after canvas:load
 * (initial seed) and after every canvas:save (to record what we just
 * wrote). Bounded by the workspace size; typical workspaces under 30ms.
 */
const seedPerNodeContent = async (workspaceId: string): Promise<void> => {
  const dir = getNodesDir(workspaceId);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    // No nodes/ dir → v1 workspace, or v2 with zero nodes. Drop any
    // stale snapshot from a previous lifecycle.
    if (isEnoent(err)) {
      lastPerNodeContent.delete(workspaceId);
      return;
    }
    console.warn(`[canvas-store] could not list nodes/ for ${workspaceId}:`, err);
    return;
  }
  const inner = new Map<string, string>();
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const nodeId = name.slice(0, -'.json'.length);
    if (!isSafeNodeId(nodeId)) continue;
    try {
      const raw = await fs.readFile(getNodeFilePath(workspaceId, nodeId), 'utf-8');
      inner.set(nodeId, raw);
    } catch {
      // Skip — transient or just-deleted.
    }
  }
  lastPerNodeContent.set(workspaceId, inner);
};

/**
 * Mark the given node ids as having just been written by us. Watcher
 * events that arrive within {@link SELF_WRITE_WINDOW_MS} are then
 * treated as our own echoes and suppressed — regardless of how the
 * snapshot diff turns out.
 *
 * This is the backstop. Bytes / visible-fields diffs depend on the
 * snapshot map being refreshed *before* the watcher's debounced fire
 * reads the file, which is a timing race we can lose under load or
 * when an async render path (iframe page-title-updated, file node
 * content read-back) triggers a save right after canvas:load — both
 * cases users have reported as a spurious "agent edited" flash.
 */
const markSelfWrites = (workspaceId: string, nodeIds: Iterable<string>): void => {
  const inner = recentSelfWrites.get(workspaceId) ?? new Map<string, number>();
  const now = Date.now();
  for (const id of nodeIds) inner.set(id, now);
  recentSelfWrites.set(workspaceId, inner);
};

const handlePerNodeBatchFire = async (workspaceId: string): Promise<void> => {
  const batch = nodeFileBatch.get(workspaceId);
  if (!batch || batch.size === 0) return;
  const nodeIds = Array.from(batch);
  nodeFileBatch.delete(workspaceId);

  const inner = lastPerNodeContent.get(workspaceId) ?? new Map<string, string>();
  const selfWrites = recentSelfWrites.get(workspaceId);
  const now = Date.now();
  const changedIds: string[] = [];

  for (const nodeId of nodeIds) {
    let raw: string;
    try {
      raw = await fs.readFile(getNodeFilePath(workspaceId, nodeId), 'utf-8');
    } catch (err) {
      if (isEnoent(err)) {
        // Per-node file was deleted. Broadcast iff we knew about it.
        if (inner.has(nodeId)) {
          inner.delete(nodeId);
          changedIds.push(nodeId);
        }
        continue;
      }
      // Transient I/O error — skip; next fire will re-check.
      continue;
    }
    const prev = inner.get(nodeId);
    // Update the snapshot unconditionally — even if we end up suppressing
    // the broadcast, the freshest bytes are the ones we want to compare
    // against next time.
    inner.set(nodeId, raw);

    if (prev === raw) continue; // exact-bytes echo of our own write
    if (prev !== undefined && !visibleFieldsChanged(prev, raw)) {
      // Only metadata (updatedAt / createdAt) churned, or `data` keys got
      // reordered by a spread upstream. The renderer can't see this
      // difference, so broadcasting would just trigger a false "agent
      // edited" highlight without anything visibly changing.
      continue;
    }
    // Self-write backstop: this watcher event almost certainly echoes a
    // canvas:save we just performed. The snapshot diff above missed it
    // (snapshot wasn't refreshed in time, or seedPerNodeContent hadn't
    // run yet for this node). Trust the timestamp record over a stale
    // snapshot.
    const ts = selfWrites?.get(nodeId);
    if (ts !== undefined && now - ts <= SELF_WRITE_WINDOW_MS) continue;

    changedIds.push(nodeId);
  }

  // GC: drop self-write entries older than the window so the map doesn't
  // grow without bound across a long session.
  if (selfWrites) {
    for (const [id, ts] of selfWrites) {
      if (now - ts > SELF_WRITE_WINDOW_MS) selfWrites.delete(id);
    }
    if (selfWrites.size === 0) recentSelfWrites.delete(workspaceId);
  }

  lastPerNodeContent.set(workspaceId, inner);
  if (changedIds.length > 0) {
    broadcastExternalUpdate(workspaceId, changedIds);
  }
};

/**
 * Compare two per-node JSON files for *user-visible* differences.
 *
 * Returns true iff `data`, `type`, or `title` differ — the three fields
 * the renderer actually reflects in the canvas. Field-order changes
 * within `data` (e.g. `{ a, b }` vs `{ b, a }` from an upstream object
 * spread) and pure metadata churn (`updatedAt` / `createdAt` only)
 * return false. Without this filter, the nodes/ watcher would broadcast
 * for every save echo even when nothing user-visible changed, falsely
 * lighting up the renderer's "externally edited" highlight on every
 * autosave.
 *
 * Conservative: if parsing fails, treat as changed and broadcast.
 * Comparing the raw bytes would be a stricter test but it's the very
 * thing we're trying to relax here.
 */
const visibleFieldsChanged = (prevRaw: string, nextRaw: string): boolean => {
  type PerNodeShape = { data?: unknown; type?: unknown; title?: unknown };
  let prev: PerNodeShape;
  let next: PerNodeShape;
  try {
    prev = JSON.parse(prevRaw) as PerNodeShape;
    next = JSON.parse(nextRaw) as PerNodeShape;
  } catch {
    return true;
  }
  if (prev.type !== next.type) return true;
  if (prev.title !== next.title) return true;
  return stableStringify(prev.data) !== stableStringify(next.data);
};

/**
 * Deterministic JSON serialization with sorted object keys, so two
 * structurally-equal objects with different key insertion orders produce
 * the same string. Used inside `visibleFieldsChanged` to defeat the
 * "renderer spread reorders keys" false positive.
 */
const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map(
    (k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]),
  );
  return '{' + parts.join(',') + '}';
};

const startNodesWatcher = (workspaceId: string): void => {
  if (nodeFileWatchers.has(workspaceId)) return;
  const dir = getNodesDir(workspaceId);
  let watcher: FSWatcher;
  try {
    watcher = fsWatch(dir, { persistent: false });
  } catch (err) {
    // ENOENT for v1 / empty-v2 workspaces. Not an error — we'll try
    // again next time canvas:load runs for this workspace (typically
    // right after the first save creates nodes/).
    if (!isEnoent(err)) {
      console.warn(`[canvas-store] nodes/ watch failed for ${workspaceId}:`, err);
    }
    return;
  }
  watcher.on('change', (_eventType, filename) => {
    if (typeof filename !== 'string' || !filename.endsWith('.json')) return;
    if (filename.endsWith('.tmp')) return; // tmp file noise from atomic writes
    const nodeId = filename.slice(0, -'.json'.length);
    if (!isSafeNodeId(nodeId)) return;

    const batch = nodeFileBatch.get(workspaceId) ?? new Set<string>();
    batch.add(nodeId);
    nodeFileBatch.set(workspaceId, batch);

    const existing = nodeFileDebounce.get(workspaceId);
    if (existing) clearTimeout(existing);
    const t = setTimeout(() => {
      nodeFileDebounce.delete(workspaceId);
      void handlePerNodeBatchFire(workspaceId);
    }, 100);
    nodeFileDebounce.set(workspaceId, t);
  });
  watcher.on('error', (err) => {
    console.warn(`[canvas-store] nodes/ watcher error for ${workspaceId}:`, err);
  });
  nodeFileWatchers.set(workspaceId, watcher);
};

const stopNodesWatcher = (workspaceId: string): void => {
  const w = nodeFileWatchers.get(workspaceId);
  if (w) {
    try { w.close(); } catch { /* ignore */ }
    nodeFileWatchers.delete(workspaceId);
  }
  const t = nodeFileDebounce.get(workspaceId);
  if (t) {
    clearTimeout(t);
    nodeFileDebounce.delete(workspaceId);
  }
  nodeFileBatch.delete(workspaceId);
  lastPerNodeContent.delete(workspaceId);
  recentSelfWrites.delete(workspaceId);
};

const stopWorkspaceWatcher = (workspaceId: string): void => {
  const w = watchers.get(workspaceId);
  if (w) {
    try { w.close(); } catch { /* ignore */ }
    watchers.delete(workspaceId);
  }
  const t = watcherDebounce.get(workspaceId);
  if (t) {
    clearTimeout(t);
    watcherDebounce.delete(workspaceId);
  }
  lastSnapshot.delete(workspaceId);
  stopNodesWatcher(workspaceId);
};

export const teardownCanvasWatchers = (): void => {
  for (const id of Array.from(watchers.keys())) stopWorkspaceWatcher(id);
  // Defensive: any nodes/ watchers without a paired canvas.json watcher
  // (theoretically impossible) also get cleaned up.
  for (const id of Array.from(nodeFileWatchers.keys())) stopNodesWatcher(id);
};

export const setupCanvasStoreIpc = () => {
  ipcMain.handle(
    'canvas:save',
    async (_event, payload: { id: string; data: unknown }) => {
      try {
        await fs.mkdir(STORE_DIR, { recursive: true });
        if (payload.id === MANIFEST_ID) {
          await atomicWriteCanvasJson(
            getFilePath(MANIFEST_ID),
            JSON.stringify(payload.data, null, 2),
          );
        } else {
          await ensureWorkspaceDir(payload.id);
          // Lazy migration: if this is a v1 workspace, transparently
          // promote to v2 before merging. Holds the same save lock so
          // any concurrent save is serialized after the migration. No-op
          // for already-v2 workspaces.
          await ensureMigrated(payload.id);
          await withSaveLock(payload.id, async () => {
            // Snapshot what the renderer actually had in memory when it
            // sent this save. We compare against this after the merge
            // to detect CLI-side changes the renderer doesn't know yet
            // (see the broadcast below).
            const rendererMemoryMap = nodesToMap(
              (payload.data as CanvasSaveData).nodes,
            );
            // First merge against current disk state. This picks up any
            // CLI-added nodes (Rule 2) and resolves per-node conflicts
            // (Rule 1).
            const firstPass = await mergeExternalNodes(
              payload.id,
              payload.data as CanvasSaveData,
            );
            if (firstPass === SKIP_WRITE) return;
            // Second merge, immediately before the write. Narrows the
            // window where a canvas-cli write could land between our
            // initial read and the writeFile below and be silently
            // clobbered. Using `firstPass` as input ensures any CLI
            // changes seen in the first read are preserved even if the
            // second read somehow fails to include them.
            const merged = await mergeExternalNodes(payload.id, firstPass);
            if (merged === SKIP_WRITE) return;
            // Mark every node id we're about to write so the nodes/
            // watcher's batch handler can recognize the upcoming events
            // as our own echoes and suppress them — even when the
            // snapshot diff misses (e.g. seedPerNodeContent loses the
            // race with the watcher's debounced fire, which is the
            // root cause of the spurious "agent edited" flash users
            // reported for iframe / file nodes).
            const mergedNodeIds: string[] = [];
            if (Array.isArray(merged.nodes)) {
              for (const n of merged.nodes as CanvasNode[]) {
                if (n.id) mergedNodeIds.push(n.id);
              }
            }
            markSelfWrites(payload.id, mergedNodeIds);
            // writeCanvasFull adapts to the current on-disk schema: for
            // v2 workspaces it splits node.data into nodes/<id>.json
            // files and writes a layout-only canvas.json; for v1 it
            // writes the whole thing inline. The canvas.json swap is
            // the commit point in both paths.
            await writeCanvasFull(payload.id, merged as CanvasSaveData);
            // Update the watcher's last-known snapshot to match what we
            // just wrote. Re-read the on-disk canvas.json so the
            // snapshot has the exact shape the fs.watch handler will see
            // — for v2 that's layout-only; for v1 it's full inline data.
            // Without this, the watcher's diff would falsely flag every
            // node as changed on every save in v2 mode.
            const onDiskMap = await readOnDiskNodeMap(payload.id);
            lastSnapshot.set(payload.id, onDiskMap);
            // Same idea for v2 per-node files: snapshot their exact
            // bytes so the nodes/ watcher's debounced fire can diff
            // against them and suppress the echo of our own write.
            // Also ensures the nodes/ watcher is running — first save
            // on a freshly-migrated workspace creates the directory,
            // and we need to start watching it now.
            await seedPerNodeContent(payload.id);
            startNodesWatcher(payload.id);
            // mergedMap (full v1-shape) is what the renderer cares about
            // for the pickedUp broadcast below — that comparison is
            // memory-vs-memory, not against the watcher snapshot.
            const mergedMap = nodesToMap(merged.nodes);
            // Now that the write has landed, mark every persisted id as
            // known so subsequent `mergeExternalNodes` calls can tell
            // "memory-only node the user just created" (not in known →
            // keep) from "CLI deleted a persisted node" (in known,
            // missing from disk → drop). Updating here rather than
            // inside `mergeExternalNodes` keeps the two back-to-back
            // merge calls within this save idempotent.
            const knownForWs = knownNodeIds.get(payload.id) ?? new Set<string>();
            if (Array.isArray(merged.nodes)) {
              for (const n of merged.nodes as CanvasNode[]) {
                if (n.id) knownForWs.add(n.id);
              }
            }
            knownNodeIds.set(payload.id, knownForWs);
            // If the merge result differs from the renderer's memory,
            // the CLI made changes between the renderer's last sync
            // and this save, and we just silently absorbed them into
            // the write. The fs.watch fire for this write will see
            // `lastSnapshot === disk` and skip broadcasting, so the
            // renderer would never hear about those changes (until a
            // manual reload). Push the diff back explicitly so its
            // in-memory state catches up.
            const pickedUp = diffSnapshots(rendererMemoryMap, mergedMap);
            if (pickedUp.length > 0) {
              broadcastExternalUpdate(payload.id, pickedUp);
            }
          });
        }
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );

  ipcMain.handle(
    'canvas:load',
    async (_event, payload: { id: string }) => {
      try {
        if (payload.id !== MANIFEST_ID) {
          await migrateIfNeeded(payload.id);
          await ensureWorkspaceDir(payload.id);
          // Lazy auto-migrate v1 → v2 silently. Returns immediately if
          // already v2 or missing. MigrationSpinner only surfaces if
          // the migration takes longer than 1s.
          await ensureMigrated(payload.id);
        }
        const filePath = getFilePath(payload.id);
        let data: CanvasSaveData;
        let recoveredFromBackup = false;
        if (payload.id === MANIFEST_ID) {
          const readResult = await readCanvasJsonWithRecovery(filePath);
          if (readResult.kind === 'missing') return { ok: true, data: null };
          if (readResult.kind === 'unrecoverable') {
            return { ok: false, error: String(readResult.err) };
          }
          data = readResult.data as CanvasSaveData;
          recoveredFromBackup = readResult.recoveredFromBackup;
        } else {
          // `readCanvasFull` returns v1-shape (with inline node.data)
          // regardless of on-disk schema. The renderer never sees v2
          // layout-only data; it observes the same shape it always has.
          const full = await readCanvasFull(payload.id);
          if (full.data === null) return { ok: true, data: null };
          data = full.data as CanvasSaveData;
          recoveredFromBackup = full.recoveredFromBackup;
        }
        if (payload.id !== MANIFEST_ID) {
          const dirty = await migrateNotePaths(payload.id, data);
          // Re-persist if migration rewrote note paths OR if we recovered
          // from the rolling backup (the primary file was corrupt; writing
          // the recovered data back heals it). Uses writeCanvasFull so v2
          // workspaces stay v2; v1 workspaces stay v1.
          if (dirty || recoveredFromBackup) {
            await writeCanvasFull(payload.id, data);
          }
          // Seed the known-id set the first time we load this workspace in
          // this app session. Do NOT re-seed on subsequent loads — the
          // external-update handler in the renderer calls `canvas:load` as
          // a peek after canvas-cli writes, and re-seeding here would race
          // with a concurrent `canvas:save`: the save's `mergeExternalNodes`
          // would then see the CLI-added id already in `known` and Rule 2
          // would drop it from the write. `mergeExternalNodes` itself keeps
          // `known` up to date whenever nodes are actually persisted.
          if (Array.isArray(data.nodes) && !knownNodeIds.has(payload.id)) {
            const known = new Set(
              data.nodes.map((n: CanvasNode) => n.id).filter((id): id is string => Boolean(id)),
            );
            knownNodeIds.set(payload.id, known);
          }
          // Seed / refresh the watcher's last-known snapshot using the
          // on-disk shape (layout-only for v2, full for v1). Starting the
          // watcher here means we only watch workspaces the user has
          // actually opened, and the canvas.json file is guaranteed to
          // exist by this point.
          lastSnapshot.set(payload.id, await readOnDiskNodeMap(payload.id));
          startWorkspaceWatcher(payload.id);
          // For v2 workspaces, also seed the per-node content snapshot
          // and start watching nodes/ so per-node data edits (canvas-cli
          // editing scrollback, mindmap nodes, etc.) propagate to the
          // renderer in real time. No-ops for v1 workspaces (nodes/ dir
          // doesn't exist yet) and harmless to re-call across loads.
          await seedPerNodeContent(payload.id);
          startNodesWatcher(payload.id);
        }
        return { ok: true, data };
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return { ok: true, data: null };
        return { ok: false, error: String(err) };
      }
    }
  );

  ipcMain.handle('canvas:list', async () => {
    try {
      await fs.mkdir(STORE_DIR, { recursive: true });
      const entries = await fs.readdir(STORE_DIR, { withFileTypes: true });
      const ids = entries
        .filter((e) => e.isDirectory() && e.name !== MANIFEST_ID)
        .map((e) => e.name);
      // Also include legacy flat files that haven't been migrated yet
      const flatIds = entries
        .filter(
          (e) =>
            e.isFile() &&
            e.name.endsWith('.json') &&
            !e.name.startsWith(MANIFEST_ID)
        )
        .map((e) => e.name.replace(/\.json$/, ''));
      return { ok: true, ids: [...new Set([...ids, ...flatIds])] };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle(
    'canvas:exportWorkspace',
    async (_event, payload: { id: string; name: string }) => {
      try {
        if (!payload.id || payload.id === MANIFEST_ID) {
          return { ok: false, error: 'Invalid workspace id.' };
        }

        const workspaceDir = getWorkspaceDir(payload.id);
        const canvas = await readWorkspaceCanvasForExport(payload.id);
        const portableCanvas = rewriteCanvasFilePaths(canvas, (filePath) => {
          const relativePath = toPortableRelativePath(filePath, workspaceDir);
          return relativePath ? portableUrlForRelativePath(relativePath) : filePath;
        });
        const files = await collectWorkspaceFiles(workspaceDir);

        const win = BrowserWindow.getFocusedWindow();
        const result = win
          ? await dialog.showSaveDialog(win, {
            title: 'Export Workspace',
            defaultPath: `${sanitizeFileName(payload.name)}.pulsecanvas.json`,
            filters: [
              { name: 'Pulse Canvas Workspace', extensions: ['pulsecanvas.json', 'json'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          })
          : await dialog.showSaveDialog({
            title: 'Export Workspace',
            defaultPath: `${sanitizeFileName(payload.name)}.pulsecanvas.json`,
            filters: [
              { name: 'Pulse Canvas Workspace', extensions: ['pulsecanvas.json', 'json'] },
              { name: 'All Files', extensions: ['*'] },
            ],
          });
        if (result.canceled || !result.filePath) {
          return { ok: false, canceled: true };
        }

        const exportPayload: WorkspaceExportPayload = {
          format: EXPORT_FORMAT,
          version: EXPORT_VERSION,
          exportedAt: new Date().toISOString(),
          workspace: { id: payload.id, name: payload.name },
          canvas: portableCanvas,
          files,
        };
        await fs.writeFile(result.filePath, JSON.stringify(exportPayload, null, 2), 'utf-8');
        return { ok: true, filePath: result.filePath, fileCount: files.length };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
  );

  ipcMain.handle('canvas:importWorkspace', async () => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const result = win
        ? await dialog.showOpenDialog(win, {
          title: 'Import Workspace',
          filters: [
            { name: 'Pulse Canvas Workspace', extensions: ['pulsecanvas.json', 'json'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        })
        : await dialog.showOpenDialog({
          title: 'Import Workspace',
          filters: [
            { name: 'Pulse Canvas Workspace', extensions: ['pulsecanvas.json', 'json'] },
            { name: 'All Files', extensions: ['*'] },
          ],
          properties: ['openFile'],
        });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }

      const raw = await fs.readFile(result.filePaths[0], 'utf-8');
      const imported = parseWorkspaceExportPayload(raw);
      const workspaceId = await createUniqueImportedWorkspaceId();
      const workspaceName = imported.workspace.name.trim() || 'Imported Workspace';
      const workspaceDir = getWorkspaceDir(workspaceId);
      await fs.mkdir(workspaceDir, { recursive: true });

      for (const file of imported.files) {
        const targetPath = resolve(workspaceDir, file.relativePath);
        const rel = relative(workspaceDir, targetPath);
        if (rel.startsWith('..') || isAbsolute(rel)) {
          throw new Error(`Workspace export contains an unsafe file path: ${file.relativePath}`);
        }
        await fs.mkdir(dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, Buffer.from(file.content, 'base64'));
      }

      const restoredCanvas = rewriteCanvasFilePaths(imported.canvas, (filePath) => {
        const relativePath = relativePathFromPortableUrl(filePath);
        if (!relativePath) return filePath;
        if (!isSafeRelativePath(relativePath)) return filePath;
        return join(workspaceDir, relativePath);
      });
      await ensureWorkspaceDir(workspaceId);
      await atomicWriteCanvasJson(getFilePath(workspaceId), JSON.stringify(restoredCanvas, null, 2));

      const restoredData = restoredCanvas as CanvasSaveData;
      if (Array.isArray(restoredData.nodes)) {
        knownNodeIds.set(
          workspaceId,
          new Set(restoredData.nodes.map((n) => n.id).filter((id): id is string => Boolean(id))),
        );
        lastSnapshot.set(workspaceId, nodesToMap(restoredData.nodes));
      }

      return { ok: true, workspaceId, workspaceName, fileCount: imported.files.length };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'canvas:delete',
    async (_event, payload: { id: string }) => {
      try {
        if (payload.id === MANIFEST_ID) return { ok: false, error: 'Cannot delete manifest' };
        stopWorkspaceWatcher(payload.id);
        knownNodeIds.delete(payload.id);
        const dir = getWorkspaceDir(payload.id);
        await fs.rm(dir, { recursive: true, force: true });
        // Also remove old flat file if it still exists
        const oldPath = join(STORE_DIR, `${payload.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
        await fs.unlink(oldPath).catch(() => undefined);
        return { ok: true };
      } catch (err: unknown) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') return { ok: true };
        return { ok: false, error: String(err) };
      }
    }
  );

  /** Returns the absolute directory path for a workspace. */
  ipcMain.handle(
    'canvas:getDir',
    async (_event, payload: { id: string }) => {
      try {
        if (payload.id === MANIFEST_ID) {
          return { ok: false, error: 'No dir for manifest' };
        }
        await ensureWorkspaceDir(payload.id);
        return { ok: true, dir: getWorkspaceDir(payload.id) };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    }
  );
};
