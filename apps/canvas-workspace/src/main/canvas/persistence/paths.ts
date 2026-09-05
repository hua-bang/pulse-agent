import { homedir } from 'os';
import { join } from 'path';
import {
  assertSafeNodeId as assertSafeWorkspaceNodeId,
  getNodeFilePath as getWorkspaceNodeFilePath,
  getNodesDir as getWorkspaceNodesDir,
  isSafeNodeId as isSafeWorkspaceNodeId,
} from '../nodes/store';

/** Root for all per-workspace storage. */
export const STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');

/** Manifest id — flat file at STORE_DIR root, not a workspace directory. */
export const MANIFEST_ID = '__workspaces__';

export const CANVAS_JSON_FILENAME = 'canvas.json';
export const NODES_DIR_NAME = 'nodes';
export const V1_BACKUP_FILENAME = 'canvas.json.v1.bak';
export const MIGRATION_SENTINEL_FILENAME = '.migrating';

export function getWorkspaceDir(workspaceId: string, root: string = STORE_DIR): string {
  return join(root, workspaceId);
}

export function getCanvasJsonPath(workspaceId: string, root: string = STORE_DIR): string {
  if (workspaceId === MANIFEST_ID) {
    return join(root, `${MANIFEST_ID}.json`);
  }
  return join(getWorkspaceDir(workspaceId, root), CANVAS_JSON_FILENAME);
}

export function getNodesDir(workspaceId: string, root: string = STORE_DIR): string {
  return getWorkspaceNodesDir(workspaceId, root);
}

export function getNodeFilePath(
  workspaceId: string,
  nodeId: string,
  root: string = STORE_DIR,
): string {
  return getWorkspaceNodeFilePath(workspaceId, nodeId, root);
}

export function getV1BackupPath(workspaceId: string, root: string = STORE_DIR): string {
  return join(getWorkspaceDir(workspaceId, root), V1_BACKUP_FILENAME);
}

export function getV1TimestampedBackupPath(
  workspaceId: string,
  timestamp: Date = new Date(),
  root: string = STORE_DIR,
): string {
  const stamp = timestamp.toISOString().replace(/[:.]/g, '-');
  return join(getWorkspaceDir(workspaceId, root), `canvas.json.v1.${stamp}.bak`);
}

export function getSentinelPath(workspaceId: string, root: string = STORE_DIR): string {
  return join(getWorkspaceDir(workspaceId, root), MIGRATION_SENTINEL_FILENAME);
}

export function isSafeNodeId(id: string): boolean {
  return isSafeWorkspaceNodeId(id);
}

export function assertSafeNodeId(id: string): void {
  assertSafeWorkspaceNodeId(id);
}
