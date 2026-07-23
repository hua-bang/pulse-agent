/**
 * Reference store — per-workspace persistence of the Library drawer's
 * pinned reference entries.
 *
 * Storage layout:
 *   ~/.pulse-coder/canvas/<workspaceId>/references.json
 *
 * Shape on disk:
 *   { version: 1, references: ReferenceEntry[] }
 *
 * Atomic writes via `<path>.tmp` + rename, same policy as artifacts.json:
 * entries are cheap to re-pin in the worst case, so no `.bak` rotation.
 */

import { promises as fs } from 'fs';
import { dirname, join, basename } from 'path';
import { homedir } from 'os';
import type { ReferenceEntry } from '../../shared/references';

const FILE_VERSION = 1;

interface ReferencesFile {
  version: number;
  references: ReferenceEntry[];
}

function referencesPath(workspaceId: string): string {
  return join(homedir(), '.pulse-coder', 'canvas', workspaceId, 'references.json');
}

function isEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}

async function atomicWrite(finalPath: string, body: string): Promise<void> {
  const dir = dirname(finalPath);
  const tmp = join(dir, `${basename(finalPath)}.tmp`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmp, body, 'utf-8');
  await fs.rename(tmp, finalPath);
}

export async function listReferences(workspaceId: string): Promise<ReferenceEntry[]> {
  let raw: string;
  try {
    raw = await fs.readFile(referencesPath(workspaceId), 'utf-8');
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as ReferencesFile;
    return Array.isArray(parsed.references) ? parsed.references : [];
  } catch (err) {
    console.warn(`[reference-store] failed to parse references.json for "${workspaceId}":`, err);
    return [];
  }
}

export async function saveReferences(workspaceId: string, references: ReferenceEntry[]): Promise<void> {
  const file: ReferencesFile = { version: FILE_VERSION, references };
  await atomicWrite(referencesPath(workspaceId), JSON.stringify(file, null, 2));
}
