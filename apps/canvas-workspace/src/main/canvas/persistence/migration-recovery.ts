import { promises as fs } from 'fs';
import { atomicWriteJson, isEnoent, readJsonWithRecovery } from './atomic-json';
import {
  STORE_DIR,
  getCanvasJsonPath,
  getNodeFilePath,
  getSentinelPath,
  getV1BackupPath,
  isSafeNodeId,
} from './paths';
import { detectSchemaVersion, type MigrationSentinel } from './schema';

export async function readSentinel(
  workspaceId: string,
  root: string = STORE_DIR,
): Promise<MigrationSentinel | null> {
  try {
    const raw = await fs.readFile(getSentinelPath(workspaceId, root), 'utf-8');
    return JSON.parse(raw) as MigrationSentinel;
  } catch (err) {
    if (isEnoent(err)) return null;
    return { startedAt: 0, workspaceId, sourceUpdatedAt: null, expectedNodeIds: [] };
  }
}

export async function writeSentinel(
  workspaceId: string,
  sentinel: MigrationSentinel,
  root: string = STORE_DIR,
): Promise<void> {
  await atomicWriteJson(getSentinelPath(workspaceId, root), JSON.stringify(sentinel, null, 2));
}

export async function deleteSentinel(
  workspaceId: string,
  root: string = STORE_DIR,
): Promise<void> {
  await fs.unlink(getSentinelPath(workspaceId, root)).catch(() => undefined);
}

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
    if (detectSchemaVersion(readResult.data) === 2) {
      await deleteSentinel(workspaceId, root);
      return true;
    }
    await cleanupPartialNodeFiles(workspaceId, sentinel.expectedNodeIds, root);
    await deleteSentinel(workspaceId, root);
    return true;
  }

  if (readResult.kind === 'missing') {
    await restoreFromV1Backup(workspaceId, root);
    await cleanupPartialNodeFiles(workspaceId, sentinel.expectedNodeIds, root);
    await deleteSentinel(workspaceId, root);
    return true;
  }

  const restored = await restoreFromV1Backup(workspaceId, root);
  if (restored) {
    await cleanupPartialNodeFiles(workspaceId, sentinel.expectedNodeIds, root);
    await deleteSentinel(workspaceId, root);
  }
  return true;
}

async function restoreFromV1Backup(workspaceId: string, root: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(getV1BackupPath(workspaceId, root), 'utf-8');
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
  root: string,
): Promise<void> {
  for (const id of expectedNodeIds) {
    if (!isSafeNodeId(id)) continue;
    await fs.unlink(getNodeFilePath(workspaceId, id, root)).catch(() => undefined);
  }
}
