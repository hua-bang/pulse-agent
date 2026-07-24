/**
 * v2-aware canvas storage primitives for canvas-cli.
 *
 * Mirrors the v2 read/write logic in
 * `apps/canvas-workspace/src/main/canvas-storage.ts` so the CLI can
 * transparently work with workspaces that have been migrated by the
 * Electron app. canvas-cli does NOT trigger migration itself —
 * migration is a UI-driven concern owned by canvas-workspace; the CLI
 * just adapts to whatever schema exists on disk.
 *
 * If this duplication becomes painful, the next step is extracting a
 * `@pulse-coder/canvas-storage` shared package both apps depend on.
 * For now, a small focused mirror is cheaper than a shared-package
 * refactor.
 *
 * v1 vs v2:
 *   v1: canvas.json contains layout + ALL node.data inline.
 *   v2: canvas.json is layout-only; each node's data lives in
 *       nodes/<nodeId>.json. Identified by `schemaVersion: 2`.
 */

import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import type { CanvasNode, CanvasSaveData } from './types';

export const NODES_DIR_NAME = 'nodes';
export const PER_NODE_SCHEMA_VERSION = 1;
export const CANVAS_SCHEMA_VERSION_V2 = 2;

/**
 * On-disk shape of `nodes/<nodeId>.json`. Self-describing so a per-node
 * file can be moved between workspaces / indexed in a knowledge base
 * without external context.
 */
export interface PerNodeFile {
  schemaVersion: typeof PER_NODE_SCHEMA_VERSION;
  id: string;
  type: string;
  title?: string;
  data: Record<string, unknown>;
  updatedAt?: number;
  createdAt?: number;
}

interface LayoutOnlyReferenceNode {
  type: 'reference';
  ref?: unknown;
}

export type SchemaVersion = 1 | 2;

/**
 * Detect on-disk schema. v1 is identified by `schemaVersion` either
 * absent, undefined, or === 1. Anything else with `nodes` is treated
 * as v1 too (forward-tolerant).
 */
export function detectSchemaVersion(parsed: unknown): SchemaVersion {
  if (parsed && typeof parsed === 'object') {
    const v = (parsed as { schemaVersion?: unknown }).schemaVersion;
    if (v === 2) return 2;
  }
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Path + safety helpers

const SAFE_NODE_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export function isSafeNodeId(id: string): boolean {
  return SAFE_NODE_ID.test(id) && id !== '.' && id !== '..';
}

export function getNodesDir(workspaceDir: string): string {
  return join(workspaceDir, NODES_DIR_NAME);
}

export function getNodeFilePath(workspaceDir: string, nodeId: string): string {
  if (!isSafeNodeId(nodeId)) {
    throw new Error(`[canvas-cli] refusing unsafe node id: ${JSON.stringify(nodeId)}`);
  }
  return join(getNodesDir(workspaceDir), `${nodeId}.json`);
}

function isEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-node I/O

/**
 * Read a single per-node file. Returns null on missing / unparseable —
 * callers fall back to empty data with a warning, never throw the whole
 * workspace load over one bad file.
 */
export async function readNodeFile(
  workspaceDir: string,
  nodeId: string,
): Promise<PerNodeFile | null> {
  if (!isSafeNodeId(nodeId)) return null;
  try {
    const raw = await fs.readFile(getNodeFilePath(workspaceDir, nodeId), 'utf-8');
    return JSON.parse(raw) as PerNodeFile;
  } catch (err) {
    if (isEnoent(err)) return null;
    console.warn(
      `[canvas-cli] unreadable per-node file ${nodeId}: ${String(err)}`,
    );
    return null;
  }
}

/**
 * Atomic per-node write via tmp + rename. No rolling backup — files are small.
 *
 * The tmp name MUST be unique per writer (same recipe as store.ts's
 * `atomicWriteCanvasJson` and the app's `atomicWriteJson`): a fixed
 * `<path>.tmp` made concurrent full-canvas saves collide on the same tmp
 * path — writer B's `writeFile` landed between writer A's `writeFile` and
 * `rename`, so one rename raced the other and threw ENOENT mid-save.
 */
export async function writeNodeFile(
  workspaceDir: string,
  file: PerNodeFile,
): Promise<void> {
  const path = getNodeFilePath(workspaceDir, file.id);
  const tmpPath =
    `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await fs.mkdir(dirname(path), { recursive: true });
  try {
    await fs.writeFile(tmpPath, JSON.stringify(file, null, 2), 'utf-8');
    await fs.rename(tmpPath, path);
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => undefined);
    throw err;
  }
}

export async function deleteNodeFile(
  workspaceDir: string,
  nodeId: string,
): Promise<void> {
  if (!isSafeNodeId(nodeId)) return;
  await fs.unlink(getNodeFilePath(workspaceDir, nodeId)).catch(() => undefined);
}

export async function listNodeFiles(workspaceDir: string): Promise<string[]> {
  const dir = getNodesDir(workspaceDir);
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
// v2 read assembly

/**
 * Assemble v1-shape `CanvasSaveData` from a v2 layout + the workspace's
 * per-node files. Missing per-node files fall back to empty `data` with a
 * warning rather than failing the whole load.
 */
export async function assembleV2(
  workspaceDir: string,
  layout: CanvasSaveData,
): Promise<CanvasSaveData> {
  const layoutNodes = Array.isArray(layout.nodes) ? layout.nodes : [];

  const assembledNodes = await Promise.all(
    layoutNodes.map(async (layoutNode) => {
      if (isLayoutOnlyReferenceNode(layoutNode)) {
        return layoutNode as CanvasNode;
      }
      const id = typeof layoutNode.id === 'string' ? layoutNode.id : null;
      if (!id) {
        return { ...layoutNode, data: {} as Record<string, unknown> } as CanvasNode;
      }
      const perNode = await readNodeFile(workspaceDir, id);
      if (!perNode) {
        console.warn(
          `[canvas-cli] node ${id} has no per-node file; using empty data`,
        );
        return { ...layoutNode, data: {} as Record<string, unknown> } as CanvasNode;
      }
      // Per-node file is canonical on drift.
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
  // The v2 marker is an internal storage detail — callers see v1-shape.
  delete (out as { schemaVersion?: number }).schemaVersion;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// v2 write split

export interface SplitV2Options {
  /**
   * Node ids whose per-node files should be deleted because the caller
   * EXPLICITLY removed them in this mutation. This is the only default
   * deletion path — see `pruneUnknownNodeFiles` for why.
   */
  removedIds?: readonly string[];
  /**
   * Restore the old "full sync" sweep: delete EVERY per-node file whose id
   * is not in the incoming snapshot. Reserved for flows that know their
   * snapshot is complete and exclusive (restore/repair). Never enable it on
   * the mutation path: a writer whose snapshot predates another writer's
   * freshly-created node would DELETE that node's file — exactly the
   * concurrent-loss incident the default protects against.
   */
  pruneUnknownNodeFiles?: boolean;
}

/**
 * Split a v1-shape `CanvasSaveData` into a v2 on-disk layout + per-node
 * files. Returns the layout to be passed to the caller's normal
 * `atomicWriteCanvasJson(...canvas.json, ...)` — keeps the commit-point
 * atomicity at the canvas.json swap, same as v1 writes.
 *
 * updatedAt arbitration: if a per-node file is newer than the incoming
 * node, we KEEP the on-disk version. Defends against a stale renderer
 * snapshot clobbering a fresh canvas-workspace edit.
 *
 * Orphan cleanup is OPT-IN per `SplitV2Options`: by default only ids the
 * caller explicitly removed are deleted; unknown per-node files (typically
 * a concurrent writer's brand-new node, else true leftovers) are preserved
 * for `doctor` to adopt or prune deliberately.
 */
export async function splitV2(
  workspaceDir: string,
  data: CanvasSaveData,
  opts: SplitV2Options = {},
): Promise<CanvasSaveData> {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const now = Date.now();
  const incomingIds = new Set<string>();

  for (const node of nodes) {
    if (!node.id || !isSafeNodeId(node.id)) continue;
    incomingIds.add(node.id);

    const existing = await readNodeFile(workspaceDir, node.id);
    if (isLayoutOnlyReferenceNode(node)) {
      if (existing) await deleteNodeFile(workspaceDir, node.id);
      continue;
    }
    const incomingUpdatedAt =
      typeof node.updatedAt === 'number' ? node.updatedAt : now;
    const existingUpdatedAt =
      existing && typeof existing.updatedAt === 'number' ? existing.updatedAt : 0;

    if (existing && existingUpdatedAt > incomingUpdatedAt) {
      // Disk is newer — preserve it.
      continue;
    }

    const file: PerNodeFile = {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: node.id,
      type: node.type,
      title: node.title,
      data: ((node as { data?: Record<string, unknown> }).data ?? {}) as Record<string, unknown>,
      updatedAt: incomingUpdatedAt,
      createdAt: existing?.createdAt ?? incomingUpdatedAt,
    };
    await writeNodeFile(workspaceDir, file);
  }

  if (opts.pruneUnknownNodeFiles) {
    const onDisk = await listNodeFiles(workspaceDir);
    for (const id of onDisk) {
      if (!incomingIds.has(id)) {
        await deleteNodeFile(workspaceDir, id);
      }
    }
  } else if (opts.removedIds?.length) {
    for (const id of opts.removedIds) {
      if (!incomingIds.has(id)) {
        await deleteNodeFile(workspaceDir, id);
      }
    }
  }

  // Strip `data` from each layout entry; everything else (id, type,
  // title, x/y/w/h, updatedAt, custom fields) stays.
  const layout: CanvasSaveData = {
    ...data,
    schemaVersion: 2,
    nodes: nodes.map((n) => stripDataFromNode(n)),
  };
  return layout;
}

function stripDataFromNode(node: CanvasNode): CanvasNode {
  if (isLayoutOnlyReferenceNode(node)) return node;
  const { data: _data, ...rest } = node as CanvasNode & { data?: unknown };
  return rest as CanvasNode;
}

function isLayoutOnlyReferenceNode(node: unknown): node is CanvasNode & LayoutOnlyReferenceNode {
  return !!node
    && typeof node === 'object'
    && (node as LayoutOnlyReferenceNode).type === 'reference'
    && (node as LayoutOnlyReferenceNode).ref != null;
}
