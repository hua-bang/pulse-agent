/**
 * Workspace enumeration for the local Pulse Canvas store.
 *
 * The renderer owns `~/.pulse-coder/canvas/__workspaces__.json` (the canonical
 * list of workspaces, with names + active id). We treat it as the source of
 * truth and union it with on-disk workspace directories so a workspace that
 * exists on disk but is missing from the manifest (e.g. created by an external
 * tool) still surfaces. Non-workspace store entries (`skills`, the manifest
 * itself) are excluded.
 *
 * Kept as a tiny focused module — mirroring `nodes/store.ts` / `nodes/tags.ts`
 * — and parameterised on `root` so it is unit-testable without touching the
 * developer's real home directory.
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { STORE_DIR } from './nodes/store';
import { getLocalCanvasStorage } from './persistence/backend';

export const WORKSPACES_MANIFEST_FILENAME = '__workspaces__.json';

/** Store directory entries that are never workspaces. */
const NON_WORKSPACE_DIRS = new Set([
  'skills', '__workspaces__', '__locks__', '__storage-backup__', '__storage_migration__.lock',
]);

export interface WorkspaceInfo {
  id: string;
  name: string;
  rootFolder?: string;
}

export interface WorkspaceListing {
  activeId?: string;
  workspaces: WorkspaceInfo[];
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/**
 * Pull workspace entries out of a parsed manifest. Both `workspaces` (used by
 * the renderer / context-builder) and `entries` (used by the legacy MCP HTTP
 * server) appear in the wild, so accept either.
 */
function manifestEntries(parsed: unknown): WorkspaceInfo[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const obj = parsed as Record<string, unknown>;
  const raw = Array.isArray(obj.workspaces)
    ? obj.workspaces
    : Array.isArray(obj.entries)
      ? obj.entries
      : [];
  const out: WorkspaceInfo[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const id = optionalText(e.id);
    if (!id) continue;
    out.push({ id, name: optionalText(e.name) ?? id, rootFolder: optionalText(e.rootFolder) });
  }
  return out;
}

/** SQL tombstones override stale manifests and retained workspace directories. */
export async function filterWorkspaceIds(root: string, ids: string[]): Promise<string[]> {
  const storage = await getLocalCanvasStorage(root);
  if (!storage) return ids;
  const visible = await Promise.all(ids.map(async id => !await storage.workspaces.getTrashed(id)));
  return ids.filter((_id, index) => visible[index]);
}

export async function hasTrashedWorkspaces(root: string = STORE_DIR): Promise<boolean> {
  const storage = await getLocalCanvasStorage(root);
  return !!(await storage?.workspaces.listTrashed({ limit: 1 }))?.items.length;
}

export async function filterWorkspaceManifest<T extends Record<string, unknown>>(root: string, manifest: T): Promise<T> {
  const rows = [manifest.workspaces, manifest.entries].filter(Array.isArray).flat() as unknown[];
  const ids = rows.flatMap(item => item && typeof item === 'object' && 'id' in item && typeof item.id === 'string' ? [item.id] : []);
  const visible = new Set(await filterWorkspaceIds(root, ids));
  const filtered: Record<string, unknown> = { ...manifest };
  for (const key of ['workspaces', 'entries']) {
    if (!Array.isArray(manifest[key])) continue;
    const folders = Array.isArray(manifest.folders) ? new Set(manifest.folders.map(folder => folder?.id)) : null;
    filtered[key] = manifest[key].filter(item => item && visible.has(item.id)).map(item => {
      if (!item.folderId || !folders || folders.has(item.folderId)) return item;
      const { folderId: _missingFolder, ...entry } = item;
      return entry;
    });
  }
  const preferred = (filtered.workspaces ?? filtered.entries) as Array<{ id: string }> | undefined;
  if (Array.isArray(preferred) && !visible.has(String(filtered.activeId ?? ''))) filtered.activeId = preferred[0]?.id ?? '';
  return filtered as T;
}

/** Read the workspace manifest. Returns an empty listing when absent/unreadable. */
export async function readWorkspaceManifest(root: string = STORE_DIR): Promise<WorkspaceListing> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(await fs.readFile(join(root, WORKSPACES_MANIFEST_FILENAME), 'utf-8'));
  } catch {
    parsed = {};
  }
  // A storage error must propagate, not reveal hidden workspaces via fallback.
  const manifest = await filterWorkspaceManifest(root, parsed);
  return { activeId: optionalText(manifest.activeId), workspaces: manifestEntries(manifest) };
}

/** Directory ids under the store that look like workspaces (best-effort fallback). */
async function listWorkspaceDirIds(root: string = STORE_DIR): Promise<string[]> {
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.')
        && !e.name.startsWith('__storage_migration__.lock') && !NON_WORKSPACE_DIRS.has(e.name))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * List every workspace in the store: manifest entries first (authoritative
 * names + order), then any on-disk workspace directory not already listed.
 */
export async function listWorkspaces(root: string = STORE_DIR): Promise<WorkspaceListing> {
  const { activeId, workspaces } = await readWorkspaceManifest(root);
  const byId = new Map(workspaces.map((w) => [w.id, w] as const));
  for (const id of await filterWorkspaceIds(root, await listWorkspaceDirIds(root))) {
    if (!byId.has(id)) byId.set(id, { id, name: id });
  }
  return { activeId, workspaces: Array.from(byId.values()) };
}
