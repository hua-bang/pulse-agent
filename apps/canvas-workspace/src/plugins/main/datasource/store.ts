/**
 * Datasource spec persistence — co-located with the rest of a
 * workspace's state under `~/.pulse-coder/canvas/<workspaceId>/`.
 *
 * Storage layout:
 *   ~/.pulse-coder/canvas/<workspaceId>/datasources/<datasourceId>.json
 *
 * Shape on disk:
 *   { version: 1, id, spec, createdAt }
 *
 * Atomic writes via `<path>.tmp` + rename so concurrent readers never
 * see a truncated file. Mirrors the artifact store's style; the only
 * notable difference is files are per-datasource (artifacts use one
 * `artifacts.json` per workspace) — datasources can be touched
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
import type { DatasourceSpec } from "./types";

const FILE_VERSION = 1;

export interface PersistedSpec {
  version: number;
  id: string;
  spec: DatasourceSpec;
  createdAt: number;
}

export interface SpecEntry {
  workspaceId: string;
  datasourceNodeId: string;
  persisted: PersistedSpec;
}

function specsDir(workspaceId: string): string {
  return join(getWorkspaceDir(workspaceId), "datasources");
}

function specPath(workspaceId: string, datasourceNodeId: string): string {
  // Hard-validate the id; we use it as a filename segment.
  if (!/^[a-zA-Z0-9._-]+$/.test(datasourceNodeId)) {
    throw new Error(`invalid datasource id: ${datasourceNodeId}`);
  }
  return join(specsDir(workspaceId), `${datasourceNodeId}.json`);
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
  datasourceNodeId: string,
): Promise<PersistedSpec | null> {
  try {
    const raw = await fs.readFile(specPath(workspaceId, datasourceNodeId), "utf-8");
    return JSON.parse(raw) as PersistedSpec;
  } catch (err) {
    if (isEnoent(err)) return null;
    throw err;
  }
}

export async function setSpec(
  workspaceId: string,
  datasourceNodeId: string,
  spec: DatasourceSpec,
  createdAt: number = Date.now(),
): Promise<PersistedSpec> {
  const persisted: PersistedSpec = {
    version: FILE_VERSION,
    id: datasourceNodeId,
    spec,
    createdAt,
  };
  await atomicWrite(
    specPath(workspaceId, datasourceNodeId),
    JSON.stringify(persisted, null, 2),
  );
  return persisted;
}

export async function deleteSpec(
  workspaceId: string,
  datasourceNodeId: string,
): Promise<void> {
  try {
    await fs.unlink(specPath(workspaceId, datasourceNodeId));
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
    const datasourceNodeId = entry.slice(0, -".json".length);
    const persisted = await getSpec(workspaceId, datasourceNodeId);
    if (persisted) {
      out.push({ workspaceId, datasourceNodeId, persisted });
    }
  }
  return out;
}

/**
 * Walk every workspace's `datasources/` directory and return all
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
