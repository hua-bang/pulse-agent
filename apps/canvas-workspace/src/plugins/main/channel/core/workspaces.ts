import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// Canvas persists each workspace under ~/.pulse-coder/canvas/<workspaceId>/
// with a canvas.json at its root. The main process has no workspace *name*
// manifest (names live in the renderer), so channels bind by workspace id.
const STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');

export interface WorkspaceInfo {
  id: string;
  /** Friendly name from the workspace manifest, when available. */
  name?: string;
  /** Last-modified epoch ms of the workspace's canvas.json (0 if unknown). */
  modifiedAt: number;
  /** True for the workspace currently open/active in the Canvas UI. */
  isActive: boolean;
}

interface WorkspaceManifest {
  workspaces: Array<{ id: string; name: string }>;
  activeId?: string;
}

// Friendly names + the UI's active workspace live in a manifest alongside the
// per-workspace directories. Read it to label workspaces by name (the dirs
// themselves are random ids).
async function readManifest(): Promise<WorkspaceManifest> {
  try {
    const raw = await fs.readFile(join(STORE_DIR, '__workspaces__.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const workspaces = (parsed.workspaces ?? parsed.entries ?? []) as WorkspaceManifest['workspaces'];
    return { workspaces, activeId: parsed.activeId as string | undefined };
  } catch {
    return { workspaces: [] };
  }
}

/**
 * Enumerate known canvas workspaces, most-recently-modified first. A
 * directory counts as a workspace when it contains a canvas.json; names and
 * the active marker come from the manifest. Empty when the store is absent.
 */
export async function listWorkspaces(): Promise<WorkspaceInfo[]> {
  let entries: import('fs').Dirent[];
  try {
    entries = await fs.readdir(STORE_DIR, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw err;
  }

  const manifest = await readManifest();
  const nameById = new Map(manifest.workspaces.map((w) => [w.id, w.name] as const));

  const infos: WorkspaceInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('__') || entry.name.startsWith('.')) continue;
    const canvasPath = join(STORE_DIR, entry.name, 'canvas.json');
    try {
      const stat = await fs.stat(canvasPath);
      infos.push({
        id: entry.name,
        name: nameById.get(entry.name),
        modifiedAt: stat.mtimeMs,
        isActive: entry.name === manifest.activeId,
      });
    } catch {
      // No canvas.json → not a workspace dir; skip.
    }
  }

  infos.sort((a, b) => b.modifiedAt - a.modifiedAt);
  return infos;
}

/** A human label for a workspace: "name (id)" when named, else the id. */
export function workspaceLabel(w: WorkspaceInfo): string {
  return w.name ? `${w.name} (${w.id})` : w.id;
}

/**
 * Resolve a user-typed workspace reference (id or friendly name, case-
 * insensitive) to a workspace id, or null when nothing matches.
 */
export async function resolveWorkspace(ref: string): Promise<string | null> {
  const needle = ref.trim();
  if (!needle) return null;
  const list = await listWorkspaces();
  const byId = list.find((w) => w.id === needle);
  if (byId) return byId.id;
  const lower = needle.toLowerCase();
  const byName = list.find((w) => w.name && w.name.toLowerCase() === lower);
  return byName?.id ?? null;
}

/** Friendly label for a workspace id (name when known). */
export async function workspaceLabelById(id: string): Promise<string> {
  const found = (await listWorkspaces()).find((w) => w.id === id);
  return found ? workspaceLabel(found) : id;
}
