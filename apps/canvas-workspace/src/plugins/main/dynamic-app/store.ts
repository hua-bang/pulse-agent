/**
 * Dynamic-app spec persistence — co-located with the rest of a
 * workspace's state under `~/.pulse-coder/canvas/<workspaceId>/`.
 *
 * Storage layout:
 *   ~/.pulse-coder/canvas/<workspaceId>/dynamic-apps/<dynamicAppId>.json
 *
 * Shape on disk:
 *   { version: 1, id, spec, createdAt }
 *
 * Atomic writes via `<path>.tmp` + rename so concurrent readers never
 * see a truncated file. Mirrors the artifact store's style; the only
 * notable difference is files are per-app (artifacts use one
 * `artifacts.json` per workspace) — apps can be touched
 * independently by the reconciler and the per-file granularity makes
 * concurrent updates safer.
 *
 * Why not the plugin store: PluginStore writes to Electron's userData
 * directory which lives separately from the canvas state. Splitting
 * workspace data across two trees makes inspection, backup, and
 * per-workspace deletion awkward — so this plugin uses direct fs.
 */

import { promises as fs } from "node:fs";
import { basename, dirname, join } from "node:path";
import { STORE_DIR, getWorkspaceDir } from "../../../main/canvas/storage";
import type { DynamicAppSpec } from "./types";

const FILE_VERSION = 1;

export interface PersistedSpec {
  version: number;
  id: string;
  spec: DynamicAppSpec;
  createdAt: number;
}

export interface SpecEntry {
  workspaceId: string;
  dynamicAppId: string;
  persisted: PersistedSpec;
}

function specsDir(workspaceId: string): string {
  return join(getWorkspaceDir(workspaceId), "dynamic-apps");
}

function specPath(workspaceId: string, dynamicAppId: string): string {
  // Hard-validate the id; we use it as a filename segment.
  if (!/^[a-zA-Z0-9._-]+$/.test(dynamicAppId)) {
    throw new Error(`invalid dynamic-app id: ${dynamicAppId}`);
  }
  return join(specsDir(workspaceId), `${dynamicAppId}.json`);
}

/** State file for a stateful dynamic app. Lives next to the spec file,
 *  named `<id>.state.json` so it doesn't show up in spec listings. */
function statePath(workspaceId: string, dynamicAppId: string): string {
  if (!/^[a-zA-Z0-9._-]+$/.test(dynamicAppId)) {
    throw new Error(`invalid dynamic-app id: ${dynamicAppId}`);
  }
  return join(specsDir(workspaceId), `${dynamicAppId}.state.json`);
}

function isEnoent(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as { code?: string }).code === "ENOENT";
}

async function atomicWrite(finalPath: string, body: string): Promise<void> {
  const dir = dirname(finalPath);
  const tmp = join(dir, `${basename(finalPath)}.tmp`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmp, body, "utf-8");
  await fs.rename(tmp, finalPath);
}

export async function getSpec(
  workspaceId: string,
  dynamicAppId: string,
): Promise<PersistedSpec | null> {
  try {
    const raw = await fs.readFile(specPath(workspaceId, dynamicAppId), "utf-8");
    return JSON.parse(raw) as PersistedSpec;
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export async function setSpec(
  workspaceId: string,
  dynamicAppId: string,
  spec: DynamicAppSpec,
  createdAt: number = Date.now(),
): Promise<PersistedSpec> {
  const persisted: PersistedSpec = {
    version: FILE_VERSION,
    id: dynamicAppId,
    spec,
    createdAt,
  };
  await atomicWrite(
    specPath(workspaceId, dynamicAppId),
    JSON.stringify(persisted, null, 2),
  );
  return persisted;
}

export async function deleteSpec(
  workspaceId: string,
  dynamicAppId: string,
): Promise<void> {
  try {
    await fs.unlink(specPath(workspaceId, dynamicAppId));
  } catch (err) {
    if (isEnoent(err)) {
      // fall through — also try to clean up the state file
    } else {
      throw err;
    }
  }
  // Tear down the sidecar state file too — orphan state would otherwise
  // re-hydrate if a future spec with the same id ever appears.
  await deleteState(workspaceId, dynamicAppId);
}

/** Read the persisted state for a stateful dynamic app. Returns null
 *  when no state file exists yet (first-time run). */
export async function getState(
  workspaceId: string,
  dynamicAppId: string,
): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(
      statePath(workspaceId, dynamicAppId),
      "utf-8",
    );
    return JSON.parse(raw);
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

/** Write state to disk atomically. Called after every action mutation. */
export async function setState(
  workspaceId: string,
  dynamicAppId: string,
  state: unknown,
): Promise<void> {
  await atomicWrite(
    statePath(workspaceId, dynamicAppId),
    JSON.stringify(state),
  );
}

/** Delete the state file (e.g. when the dynamic app is removed). */
export async function deleteState(
  workspaceId: string,
  dynamicAppId: string,
): Promise<void> {
  try {
    await fs.unlink(statePath(workspaceId, dynamicAppId));
  } catch (err) {
    if (isEnoent(err)) return;
    throw err;
  }
}

export async function listWorkspaceSpecs(
  workspaceId: string,
): Promise<SpecEntry[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(specsDir(workspaceId));
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  const out: SpecEntry[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.endsWith(".tmp")) continue;
    // Skip state sidecar files — they share the same .json extension
    // and would otherwise be loaded as if they were specs.
    if (entry.endsWith(".state.json")) continue;
    const dynamicAppId = entry.slice(0, -".json".length);
    const persisted = await getSpec(workspaceId, dynamicAppId);
    if (persisted) {
      out.push({ workspaceId, dynamicAppId, persisted });
    }
  }
  return out;
}

/**
 * Walk every workspace`s `dynamic-apps/` directory and return all
 * persisted specs. Used by the reconciler on startup.
 */
export async function listAllSpecs(): Promise<SpecEntry[]> {
  let workspaceIds: string[];
  try {
    const entries = await fs.readdir(STORE_DIR, { withFileTypes: true });
    workspaceIds = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith("__"))
      .map((e) => e.name);
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  const out: SpecEntry[] = [];
  for (const workspaceId of workspaceIds) {
    out.push(...(await listWorkspaceSpecs(workspaceId)));
  }
  return out;
}
