import { promises as fs } from 'fs';
import { join, dirname, basename } from 'path';
import { homedir } from 'os';

export const STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');
export const NODES_DIR_NAME = 'nodes';

/** Current on-disk schema version for workspace-local knowledge nodes. */
export const WORKSPACE_NODE_SCHEMA_VERSION = 1;

export type WorkspaceNodePropertyValue =
  | string
  | number
  | boolean
  | null
  | string[]
  | number[]
  | { type: 'date'; value: string }
  | { type: 'url'; value: string }
  | { type: 'file'; path: string }
  | { type: 'node'; nodeId: string }
  | { type: 'workspace-node'; workspaceId: string; nodeId: string };

export interface WorkspaceNodeLink {
  relation: string;
  target: {
    workspaceId?: string;
    nodeId: string;
  };
  title?: string;
  properties?: Record<string, WorkspaceNodePropertyValue>;
}

/**
 * Workspace-local atomic knowledge record.
 *
 * Stored at `~/.pulse-coder/canvas/<workspaceId>/nodes/<nodeId>.json`.
 * Canvas layout lives in `canvas.json`; this file is the reusable node body.
 */
export interface WorkspaceNodeRecord {
  schemaVersion: typeof WORKSPACE_NODE_SCHEMA_VERSION;
  id: string;
  type: string;
  title?: string;
  data: Record<string, unknown>;
  properties?: Record<string, WorkspaceNodePropertyValue>;
  links?: WorkspaceNodeLink[];
  updatedAt?: number;
  createdAt?: number;
}

export function getWorkspaceDir(workspaceId: string, root: string = STORE_DIR): string {
  return join(root, workspaceId);
}

export function getNodesDir(workspaceId: string, root: string = STORE_DIR): string {
  return join(getWorkspaceDir(workspaceId, root), NODES_DIR_NAME);
}

/**
 * Node-id whitelist. Rejects path traversal, separators, and shell-style
 * special chars. Matches renderer-generated ids while staying conservative.
 */
const SAFE_NODE_ID = /^[A-Za-z0-9_.-]{1,128}$/;

export function isSafeNodeId(id: string): boolean {
  return SAFE_NODE_ID.test(id) && id !== '.' && id !== '..';
}

export function assertSafeNodeId(id: string): void {
  if (!isSafeNodeId(id)) {
    throw new Error(`[workspace-node-store] refusing unsafe node id: ${JSON.stringify(id)}`);
  }
}

export function getNodeFilePath(
  workspaceId: string,
  nodeId: string,
  root: string = STORE_DIR,
): string {
  assertSafeNodeId(nodeId);
  return join(getNodesDir(workspaceId, root), `${nodeId}.json`);
}

function isEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}

/**
 * Atomically write JSON to disk via tmp + rename.
 * Kept local to avoid coupling the node store back to canvas-storage.
 */
async function atomicWriteJson(finalPath: string, serialized: string): Promise<void> {
  const dir = dirname(finalPath);
  const tmpPath = join(dir, `${basename(finalPath)}.tmp`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, serialized, 'utf-8');
  await fs.rename(tmpPath, finalPath);
}

/**
 * Read a workspace node record. Returns null if missing or unparseable —
 * callers can decide whether to synthesize empty data or surface an issue.
 */
export async function readWorkspaceNode(
  workspaceId: string,
  nodeId: string,
  root: string = STORE_DIR,
): Promise<WorkspaceNodeRecord | null> {
  if (!isSafeNodeId(nodeId)) return null;
  try {
    const raw = await fs.readFile(getNodeFilePath(workspaceId, nodeId, root), 'utf-8');
    return JSON.parse(raw) as WorkspaceNodeRecord;
  } catch (err) {
    if (isEnoent(err)) return null;
    console.warn(
      `[workspace-node-store] unreadable node ${nodeId} in ${workspaceId}: ${String(err)}`,
    );
    return null;
  }
}

export async function writeWorkspaceNode(
  workspaceId: string,
  record: WorkspaceNodeRecord,
  root: string = STORE_DIR,
): Promise<void> {
  assertSafeNodeId(record.id);
  const path = getNodeFilePath(workspaceId, record.id, root);
  const serialized = JSON.stringify(record, null, 2);
  // Whole-canvas saves funnel every node through here even when only one
  // changed — skip the atomic write (temp file + rename + watcher echo)
  // when the on-disk record is already byte-identical.
  const current = await fs.readFile(path, 'utf-8').catch(() => undefined);
  if (current === serialized) return;
  await atomicWriteJson(path, serialized);
}

export async function deleteWorkspaceNode(
  workspaceId: string,
  nodeId: string,
  root: string = STORE_DIR,
): Promise<void> {
  if (!isSafeNodeId(nodeId)) return;
  await fs.unlink(getNodeFilePath(workspaceId, nodeId, root)).catch(() => undefined);
}

/** List node ids for every JSON record in the workspace node store. */
export async function listWorkspaceNodeIds(
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

export async function listWorkspaceNodes(
  workspaceId: string,
  root: string = STORE_DIR,
): Promise<WorkspaceNodeRecord[]> {
  const ids = await listWorkspaceNodeIds(workspaceId, root);
  const out: WorkspaceNodeRecord[] = [];
  for (const id of ids) {
    const record = await readWorkspaceNode(workspaceId, id, root);
    if (record) out.push(record);
  }
  return out;
}
