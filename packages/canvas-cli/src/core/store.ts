import { promises as fs } from 'fs';
import { join, dirname, basename, resolve, relative, isAbsolute } from 'path';
import { DEFAULT_STORE_DIR, AGENTS_MD_TEMPLATE } from './constants';
import type { CanvasNode, CanvasEdge, CanvasSaveData, WorkspaceManifest, Result } from './types';
import {
  detectSchemaVersion,
  assembleV2,
  splitV2,
} from './storage-v2';

function resolveDir(storeDir?: string): string {
  return storeDir ?? DEFAULT_STORE_DIR;
}

function manifestPath(storeDir?: string): string {
  return join(resolveDir(storeDir), '__workspaces__.json');
}

function manifestLockPath(storeDir?: string): string {
  return join(resolveDir(storeDir), '__workspaces__.lock');
}

function canvasPath(workspaceId: string, storeDir?: string): string {
  return join(getWorkspaceDir(workspaceId, storeDir), 'canvas.json');
}

const NON_WORKSPACE_DIRS = new Set(['skills', '__workspaces__', '__workspaces__.lock']);

export function isSafeWorkspaceId(workspaceId: string): boolean {
  if (!workspaceId) return false;
  if (workspaceId === '.' || workspaceId === '..') return false;
  if (workspaceId === '__workspaces__' || workspaceId === '__workspaces__.json') return false;
  if (NON_WORKSPACE_DIRS.has(workspaceId)) return false;
  if (workspaceId.includes('/') || workspaceId.includes('\\')) return false;
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(workspaceId);
}

function assertSafeWorkspaceId(workspaceId: string): void {
  if (!isSafeWorkspaceId(workspaceId)) {
    throw new Error(`[canvas-cli] unsafe workspace id: "${workspaceId}"`);
  }
}

export function getWorkspaceDir(workspaceId: string, storeDir?: string): string {
  assertSafeWorkspaceId(workspaceId);
  const root = resolve(resolveDir(storeDir));
  const dir = resolve(root, workspaceId);
  const rel = relative(root, dir);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`[canvas-cli] unsafe workspace path for id: "${workspaceId}"`);
  }
  return dir;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withManifestLock<T>(storeDir: string | undefined, fn: () => Promise<T>): Promise<T> {
  const root = resolveDir(storeDir);
  await fs.mkdir(root, { recursive: true });
  const lockDir = manifestLockPath(storeDir);
  const started = Date.now();
  const staleAfterMs = 10_000;
  const timeoutMs = 15_000;

  while (true) {
    try {
      await fs.mkdir(lockDir);
      await fs.writeFile(join(lockDir, 'owner'), `${process.pid}\n${new Date().toISOString()}\n`, 'utf-8');
      break;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EEXIST') throw err;
      try {
        const stat = await fs.stat(lockDir);
        if (Date.now() - stat.mtimeMs > staleAfterMs) {
          await fs.rm(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started > timeoutMs) {
        throw new Error('[canvas-cli] timed out waiting for workspace manifest lock');
      }
      await sleep(25 + Math.floor(Math.random() * 35));
    }
  }

  try {
    return await fn();
  } finally {
    await fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

function shouldRotateBackup(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const obj = parsed as { nodes?: unknown[]; workspaces?: unknown[]; entries?: unknown[] };
  return (
    (Array.isArray(obj.nodes) && obj.nodes.length > 0) ||
    (Array.isArray(obj.workspaces) && obj.workspaces.length > 0) ||
    (Array.isArray(obj.entries) && obj.entries.length > 0)
  );
}

/**
 * Atomically write canvas JSON with a rolling `.bak` backup.
 *
 * `fs.writeFile` is non-atomic — it truncates first, then streams bytes.
 * A crash or a concurrent reader hitting that window leaves the file
 * empty/partial, producing "Unexpected end of JSON input" on next load.
 * With multiple writers racing on the same file (canvas-workspace,
 * canvas-cli, canvas-agent, MCP server), the truncate window is wide
 * enough to corrupt data in practice. This helper:
 *   1. Writes the new content to `<path>.tmp`.
 *   2. Copies the current `<path>` to `<path>.bak` iff it parses and looks
 *      like useful canvas or workspace data (rolling last-known-good snapshot).
 *   3. Renames `<path>.tmp` → `<path>`. Rename is atomic on the same
 *      filesystem, so concurrent readers see either the old or the new
 *      file — never a truncated one.
 *
 * The matching `loadCanvas` below falls back to `<path>.bak` if the
 * primary file can't be read, giving self-healing recovery from any
 * pre-existing corruption left by older non-atomic writes.
 */
export async function atomicWriteCanvasJson(
  finalPath: string,
  serialized: string,
): Promise<void> {
  const dir = dirname(finalPath);
  const base = basename(finalPath);
  const tmpPath = join(
    dir,
    `${base}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  const bakPath = join(dir, `${base}.bak`);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, serialized, 'utf-8');

  // Rotate last-known-good into .bak BEFORE overwriting, but only if
  // the current file is actually a good snapshot. Otherwise a single
  // corrupt save would poison the backup.
  try {
    const currentRaw = await fs.readFile(finalPath, 'utf-8');
    try {
      if (shouldRotateBackup(JSON.parse(currentRaw))) {
        await fs.copyFile(finalPath, bakPath).catch(() => undefined);
      }
    } catch {
      // Current file is already corrupt — leave the existing .bak alone.
    }
  } catch {
    // No current file yet; nothing to back up.
  }

  await fs.rename(tmpPath, finalPath);
}

export async function loadWorkspaceManifest(storeDir?: string): Promise<WorkspaceManifest> {
  const path = manifestPath(storeDir);
  const backupPath = `${path}.bak`;
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    // Support both Electron format ("workspaces") and legacy CLI format ("entries")
    const workspaces = (parsed.workspaces ?? parsed.entries ?? []) as WorkspaceManifest['workspaces'];
    return { workspaces, activeId: parsed.activeId as string | undefined };
  } catch (primaryErr) {
    try {
      const raw = await fs.readFile(backupPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const workspaces = (parsed.workspaces ?? parsed.entries ?? []) as WorkspaceManifest['workspaces'];
      console.warn(
        `[canvas-cli] workspace manifest unreadable (${String(primaryErr)}); recovered from __workspaces__.json.bak`,
      );
      return { workspaces, activeId: parsed.activeId as string | undefined };
    } catch {
      return { workspaces: [] };
    }
  }
}

export async function saveWorkspaceManifest(manifest: WorkspaceManifest, storeDir?: string): Promise<void> {
  await withManifestLock(storeDir, async () => {
    const dir = resolveDir(storeDir);
    await fs.mkdir(dir, { recursive: true });
    await atomicWriteCanvasJson(manifestPath(storeDir), JSON.stringify(manifest, null, 2));
  });
}

async function updateWorkspaceManifest(
  storeDir: string | undefined,
  updater: (manifest: WorkspaceManifest) => WorkspaceManifest | void,
): Promise<WorkspaceManifest> {
  return withManifestLock(storeDir, async () => {
    const manifest = await loadWorkspaceManifest(storeDir);
    const next = updater(manifest) ?? manifest;
    await atomicWriteCanvasJson(manifestPath(storeDir), JSON.stringify(next, null, 2));
    return next;
  });
}

export async function listWorkspaceIds(storeDir?: string): Promise<string[]> {
  const dir = resolveDir(storeDir);
  const ids = new Set<string>();
  try {
    await fs.mkdir(dir, { recursive: true });
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (!isSafeWorkspaceId(entry.name)) continue;
      ids.add(entry.name);
    }
  } catch {
    // Fall through to manifest entries, if any.
  }
  const manifest = await loadWorkspaceManifest(storeDir);
  for (const entry of manifest.workspaces ?? []) {
    if (isSafeWorkspaceId(entry.id)) ids.add(entry.id);
  }
  return Array.from(ids);
}

export async function ensureWorkspaceDir(workspaceId: string, storeDir?: string): Promise<void> {
  assertSafeWorkspaceId(workspaceId);
  const dir = getWorkspaceDir(workspaceId, storeDir);
  await fs.mkdir(dir, { recursive: true });
  const agentsPath = join(dir, 'AGENTS.md');
  const exists = await fs.access(agentsPath).then(() => true).catch(() => false);
  if (!exists) {
    await fs.writeFile(agentsPath, AGENTS_MD_TEMPLATE, 'utf-8');
  }
}

/**
 * Thrown by `loadCanvas` when the canvas file exists on disk but is
 * unreadable — typically because another writer caught it mid-flush and
 * `JSON.parse` failed, or because of an I/O error.
 *
 * This is deliberately distinct from the null-return-on-ENOENT case so
 * callers can tell "the canvas really doesn't exist" (safe to bootstrap)
 * apart from "we couldn't read the canvas right now" (DO NOT bootstrap —
 * that would silently wipe real user data).
 */
export class CanvasReadError extends Error {
  readonly workspaceId: string;
  readonly cause: unknown;
  constructor(workspaceId: string, cause: unknown) {
    super(
      `[canvas-cli] failed to read canvas.json for workspace "${workspaceId}": ` +
      `${cause instanceof Error ? cause.message : String(cause)}`,
    );
    this.name = 'CanvasReadError';
    this.workspaceId = workspaceId;
    this.cause = cause;
  }
}

function isEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}

export async function loadCanvas(workspaceId: string, storeDir?: string): Promise<CanvasSaveData | null> {
  const primary = canvasPath(workspaceId, storeDir);
  const backup = `${primary}.bak`;

  let primaryErr: unknown = null;
  let raw: string | null = null;
  try {
    raw = await fs.readFile(primary, 'utf-8');
  } catch (err) {
    if (isEnoent(err)) {
      // Primary genuinely absent — fall through to the backup check so a
      // corruption that deleted the primary can still self-heal.
      raw = null;
    } else {
      primaryErr = err;
    }
  }

  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as CanvasSaveData;
      parsed.nodes = parsed.nodes ?? [];
      return await materialize(workspaceId, parsed, storeDir);
    } catch (err) {
      primaryErr = err;
      raw = null;
    }
  }

  // Primary unreadable or unparseable: try the rolling .bak snapshot so
  // one bad write doesn't permanently destroy the workspace's nodes.
  try {
    const bakRaw = await fs.readFile(backup, 'utf-8');
    const parsed = JSON.parse(bakRaw) as CanvasSaveData;
    parsed.nodes = parsed.nodes ?? [];
    if (primaryErr) {
      console.warn(
        `[canvas-cli] canvas.json for "${workspaceId}" unreadable (${String(primaryErr)}); recovered from canvas.json.bak`,
      );
    }
    return await materialize(workspaceId, parsed, storeDir);
  } catch (bakErr) {
    if (isEnoent(bakErr) && !primaryErr) {
      // Neither file exists — legitimate "no canvas yet".
      return null;
    }
    // Primary failed AND backup is missing/bad, OR primary missing and
    // backup corrupt. Surface the primary's failure so callers don't
    // confuse it with "no canvas" and bootstrap an empty one on top.
    throw new CanvasReadError(workspaceId, primaryErr ?? bakErr);
  }
}

/**
 * Materialize a freshly-parsed canvas.json into v1-shape regardless of
 * on-disk format. For v2 workspaces (split storage), reads each
 * `nodes/<id>.json` and assembles them back into the inline-data shape
 * existing callers expect. For v1 (or anything unrecognized) returns the
 * data as-is.
 *
 * canvas-cli does NOT trigger migration — that's owned by canvas-workspace.
 * Whatever schema is on disk is what the CLI sees and writes back.
 */
async function materialize(
  workspaceId: string,
  parsed: CanvasSaveData,
  storeDir?: string,
): Promise<CanvasSaveData> {
  if (detectSchemaVersion(parsed) !== 2) return parsed;
  const wsDir = getWorkspaceDir(workspaceId, storeDir);
  return (await assembleV2(wsDir, parsed)) as CanvasSaveData;
}

export interface SaveCanvasOptions {
  /**
   * Allow the save to proceed even when `data.nodes` is empty and the on-disk
   * canvas currently has nodes. Default `false`: the save throws to protect
   * against accidental wipes (buggy caller flushing uninitialized state,
   * partially-loaded in-memory snapshot, etc).
   *
   * Set to `true` for flows that legitimately may end up with an empty
   * canvas, e.g. initializing a brand-new workspace or an explicit per-node
   * deletion that happens to remove the last node.
   */
  allowEmpty?: boolean;
}

/**
 * Thrown by `saveCanvas` when the incoming data has an empty `nodes` array
 * but the on-disk canvas currently has nodes, and the caller did not pass
 * `{ allowEmpty: true }`.
 */
export class CanvasWipeRefusedError extends Error {
  readonly workspaceId: string;
  readonly existingNodeCount: number;
  constructor(workspaceId: string, existingNodeCount: number) {
    super(
      `[canvas-cli] refusing to overwrite ${existingNodeCount} on-disk nodes ` +
      `with empty nodes for workspace "${workspaceId}". ` +
      `Pass { allowEmpty: true } to saveCanvas if this wipe is intentional.`,
    );
    this.name = 'CanvasWipeRefusedError';
    this.workspaceId = workspaceId;
    this.existingNodeCount = existingNodeCount;
  }
}

export async function saveCanvas(
  workspaceId: string,
  data: CanvasSaveData,
  storeDir?: string,
  opts: SaveCanvasOptions = {},
): Promise<void> {
  await ensureWorkspaceDir(workspaceId, storeDir);

  // Safety: don't silently overwrite a non-empty canvas with empty nodes.
  // This mirrors the Electron main-process guard in
  // `apps/canvas-workspace/src/main/canvas-store.ts` so every write path
  // into `canvas.json` has the same protection.
  if (!opts.allowEmpty && Array.isArray(data.nodes) && data.nodes.length === 0) {
    let raw: string | null = null;
    try {
      raw = await fs.readFile(canvasPath(workspaceId, storeDir), 'utf-8');
    } catch (err) {
      if (!isEnoent(err)) {
        // Can't verify what's on disk — refuse rather than risk wiping
        // a populated canvas we just happened to fail to read.
        throw new CanvasReadError(workspaceId, err);
      }
      // ENOENT → nothing on disk, fall through and write.
    }
    if (raw !== null) {
      let existingNodes: CanvasNode[];
      try {
        const existing = JSON.parse(raw) as CanvasSaveData;
        existingNodes = Array.isArray(existing.nodes) ? existing.nodes : [];
      } catch (err) {
        // Parse failure mid-flight: if we assume "nothing to protect" and
        // write `{nodes: []}` we'd be committing the exact data-loss bug
        // this guard exists to prevent. Refuse.
        throw new CanvasReadError(workspaceId, err);
      }
      if (existingNodes.length > 0) {
        throw new CanvasWipeRefusedError(workspaceId, existingNodes.length);
      }
    }
  }

  await writeMatchingSchema(workspaceId, data, storeDir);
}

/**
 * Write `data` (v1-shape with inline node.data) to disk in whichever
 * schema is currently in use for this workspace. v1 → write the whole
 * file inline as before. v2 → split into layout + per-node files and
 * atomic-write canvas.json as the commit point.
 *
 * Fresh workspaces (no canvas.json yet) default to v1. canvas-workspace
 * is the only path that promotes a workspace to v2 (lazy migration on
 * read); canvas-cli always preserves whatever format is already there.
 */
async function writeMatchingSchema(
  workspaceId: string,
  data: CanvasSaveData,
  storeDir?: string,
): Promise<void> {
  const canvasFile = canvasPath(workspaceId, storeDir);
  const wsDir = getWorkspaceDir(workspaceId, storeDir);

  let currentVersion: 1 | 2 = 1;
  try {
    const raw = await fs.readFile(canvasFile, 'utf-8');
    try {
      const existing = JSON.parse(raw);
      currentVersion = detectSchemaVersion(existing);
    } catch {
      // Unparseable current file — treat as v1 fresh write; the
      // empty-write guard upstream already protects against clobbering
      // a non-empty canvas when memory is empty.
    }
  } catch (err) {
    if (!isEnoent(err)) throw err;
    // Fresh workspace: stay v1.
  }

  if (currentVersion === 2) {
    const layout = await splitV2(wsDir, data);
    await atomicWriteCanvasJson(canvasFile, JSON.stringify(layout, null, 2));
    return;
  }

  // v1: write inline shape, stripping any stray schemaVersion so the
  // file stays cleanly v1.
  const payload: CanvasSaveData = { ...data };
  delete (payload as { schemaVersion?: 1 | 2 }).schemaVersion;
  await atomicWriteCanvasJson(canvasFile, JSON.stringify(payload, null, 2));
}

/**
 * Describes a single-node mutation to apply atomically against the latest
 * on-disk canvas. Exactly one of the fields should be set:
 *  - upsert: insert or replace the given node (matched by id)
 *  - removeId: remove the node with this id
 */
export interface NodeMutation {
  upsert?: CanvasNode;
  removeId?: string;
}

/**
 * Apply a single-node mutation by re-reading canvas.json immediately before
 * writing it back. This shrinks the race window with other writers
 * (Electron renderer autosave, other canvas-cli invocations) from the
 * duration of the calling function down to the time between this read and
 * the subsequent `writeFile` — typically microseconds.
 *
 * The caller is responsible for having already performed any side effects
 * (e.g. writing the backing note file on disk) before calling this.
 */
export async function commitNodeMutation(
  workspaceId: string,
  mutation: NodeMutation,
  storeDir?: string,
): Promise<CanvasSaveData | null> {
  const fresh = (await loadCanvas(workspaceId, storeDir)) ?? {
    nodes: [],
    transform: { x: 0, y: 0, scale: 1 },
    savedAt: new Date().toISOString(),
  };

  if (mutation.upsert) {
    const target = mutation.upsert;
    const idx = fresh.nodes.findIndex(n => n.id === target.id);
    if (idx >= 0) fresh.nodes[idx] = target;
    else fresh.nodes.push(target);
  }
  if (mutation.removeId) {
    const idx = fresh.nodes.findIndex(n => n.id === mutation.removeId);
    if (idx === -1) return null;
    fresh.nodes.splice(idx, 1);
  }

  fresh.savedAt = new Date().toISOString();
  // `removeId` can legitimately reduce the canvas to 0 nodes when the user
  // deletes the last one; opt in so the wipe guard doesn't reject that.
  await saveCanvas(workspaceId, fresh, storeDir, { allowEmpty: true });
  return fresh;
}

/**
 * Describes a single-edge mutation to apply atomically against the latest
 * on-disk canvas. Exactly one of the fields should be set:
 *  - upsert: insert or replace the given edge (matched by id)
 *  - removeId: remove the edge with this id
 */
export interface EdgeMutation {
  upsert?: CanvasEdge;
  removeId?: string;
}

/**
 * Apply a single-edge mutation by re-reading canvas.json immediately before
 * writing it back. Mirrors `commitNodeMutation` but operates on the `edges`
 * array. The caller is responsible for validating endpoints (e.g. node ids
 * exist) before calling this.
 */
export async function commitEdgeMutation(
  workspaceId: string,
  mutation: EdgeMutation,
  storeDir?: string,
): Promise<CanvasSaveData | null> {
  const fresh = (await loadCanvas(workspaceId, storeDir)) ?? {
    nodes: [],
    edges: [],
    transform: { x: 0, y: 0, scale: 1 },
    savedAt: new Date().toISOString(),
  };

  const edges = fresh.edges ?? [];

  if (mutation.upsert) {
    const target = mutation.upsert;
    const idx = edges.findIndex(e => e.id === target.id);
    if (idx >= 0) edges[idx] = target;
    else edges.push(target);
  }
  if (mutation.removeId) {
    const idx = edges.findIndex(e => e.id === mutation.removeId);
    if (idx === -1) return null;
    edges.splice(idx, 1);
  }

  fresh.edges = edges;
  fresh.savedAt = new Date().toISOString();
  await saveCanvas(workspaceId, fresh, storeDir, { allowEmpty: true });
  return fresh;
}

export async function createWorkspace(
  name: string,
  storeDir?: string,
): Promise<Result<{ id: string }>> {
  let createdDir: string | null = null;
  try {
    const id = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await ensureWorkspaceDir(id, storeDir);
    createdDir = getWorkspaceDir(id, storeDir);

    // Initialize empty canvas
    const emptyCanvas: CanvasSaveData = {
      nodes: [],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: new Date().toISOString(),
    };
    // Brand-new workspace: the canvas file shouldn't exist yet, but opt in
    // explicitly so the wipe guard is never tripped by this bootstrap step.
    await saveCanvas(id, emptyCanvas, storeDir, { allowEmpty: true });

    await updateWorkspaceManifest(storeDir, (manifest) => {
      const workspaces = manifest.workspaces ?? [];
      if (!workspaces.some(entry => entry.id === id)) {
        workspaces.push({ id, name });
      }
      manifest.workspaces = workspaces;
      return manifest;
    });

    return { ok: true, data: { id } };
  } catch (err) {
    if (createdDir) {
      await fs.rm(createdDir, { recursive: true, force: true }).catch(() => undefined);
    }
    return { ok: false, error: String(err) };
  }
}

export async function deleteWorkspace(
  workspaceId: string,
  storeDir?: string,
): Promise<Result> {
  try {
    assertSafeWorkspaceId(workspaceId);
    const dir = getWorkspaceDir(workspaceId, storeDir);

    await updateWorkspaceManifest(storeDir, (manifest) => {
      manifest.workspaces = (manifest.workspaces ?? []).filter(e => e.id !== workspaceId);
      if (manifest.activeId === workspaceId) {
        manifest.activeId = manifest.workspaces[0]?.id;
      }
      return manifest;
    });

    await fs.rm(dir, { recursive: true, force: true });

    return { ok: true, data: undefined };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
