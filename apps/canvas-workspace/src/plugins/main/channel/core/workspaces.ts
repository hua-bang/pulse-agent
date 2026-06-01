import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Canvas persists each workspace under ~/.pulse-coder/canvas/<workspaceId>/
// with a canvas.json at its root. The main process has no workspace *name*
// manifest (names live in the renderer), so channels bind by workspace id.
const STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');

export interface WorkspaceInfo {
  id: string;
  /** Last-modified epoch ms of the workspace's canvas.json (0 if unknown). */
  modifiedAt: number;
}

/**
 * Enumerate known canvas workspaces, most-recently-modified first. A
 * directory counts as a workspace when it contains a canvas.json. Returns
 * an empty list when the store does not exist yet.
 */
export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(STORE_DIR, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw err;
  }

  const infos: WorkspaceInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const canvasPath = join(STORE_DIR, entry.name, 'canvas.json');
    try {
      const stat = await fs.stat(canvasPath);
      infos.push({ id: entry.name, modifiedAt: stat.mtimeMs });
    } catch {
      // No canvas.json → not a workspace dir; skip.
    }
  }

  infos.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return infos;
}

/** True when a workspace directory with a canvas.json exists for `id`. */
export async function workspaceExists(id: string): Promise<boolean> {
  if (!id) return false;
  try {
    await fs.stat(join(STORE_DIR, id, 'canvas.json'));
    return true;
  } catch {
    return false;
  }
}
