/**
 * Artifact store — per-workspace persistence of LLM-generated visual products.
 *
 * Storage layout:
 *   ~/.pulse-coder/canvas/<workspaceId>/artifacts.json
 *
 * Shape on disk:
 *   { version: 1, artifacts: Artifact[] }
 *
 * Atomic writes via `<path>.tmp` + rename so concurrent readers never see a
 * truncated file. No `.bak` rotation here — artifacts are losable in the
 * worst case (regenerable from the chat), unlike canvas.json which holds
 * the user's spatial layout.
 */

import { BrowserWindow } from 'electron';
import { promises as fs } from 'fs';
import { dirname, join, basename } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

const STORE_DIR = join(homedir(), '.pulse-coder', 'canvas');
const FILE_VERSION = 1;

export type ArtifactType = 'html' | 'svg' | 'mermaid';

export interface ArtifactVersion {
  id: string;
  content: string;
  prompt?: string;
  createdAt: number;
}

export interface Artifact {
  id: string;
  workspaceId: string;
  type: ArtifactType;
  title: string;
  versions: ArtifactVersion[];
  currentVersionId: string;
  pinnedNodeId?: string;
  source?: {
    sessionId?: string;
    messageIndex?: number;
    origin?: 'agent_tool' | 'inline_promotion' | 'iframe_ai_tab';
  };
  createdAt: number;
  updatedAt: number;
}

interface ArtifactsFile {
  version: number;
  artifacts: Artifact[];
}

function artifactsPath(workspaceId: string): string {
  return join(STORE_DIR, workspaceId, 'artifacts.json');
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

async function readArtifacts(workspaceId: string): Promise<Artifact[]> {
  let raw: string;
  try {
    raw = await fs.readFile(artifactsPath(workspaceId), 'utf-8');
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }
  try {
    const parsed = JSON.parse(raw) as ArtifactsFile;
    return Array.isArray(parsed.artifacts) ? parsed.artifacts : [];
  } catch (err) {
    console.warn(`[artifact-store] failed to parse artifacts.json for "${workspaceId}":`, err);
    return [];
  }
}

async function writeArtifacts(workspaceId: string, artifacts: Artifact[]): Promise<void> {
  const file: ArtifactsFile = { version: FILE_VERSION, artifacts };
  await atomicWrite(artifactsPath(workspaceId), JSON.stringify(file, null, 2));
}

function broadcast(event: { workspaceId: string; artifactId: string; kind: 'create' | 'update' | 'delete' }): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send('artifact:change', event);
  }
}

// ─── Public API ────────────────────────────────────────────────────

export async function listArtifacts(workspaceId: string): Promise<Artifact[]> {
  return readArtifacts(workspaceId);
}

export async function getArtifact(workspaceId: string, artifactId: string): Promise<Artifact | null> {
  const all = await readArtifacts(workspaceId);
  return all.find(a => a.id === artifactId) ?? null;
}

export async function createArtifact(
  workspaceId: string,
  input: {
    type: ArtifactType;
    title: string;
    content: string;
    prompt?: string;
    source?: Artifact['source'];
  },
): Promise<Artifact> {
  const all = await readArtifacts(workspaceId);
  const now = Date.now();
  const versionId = randomUUID();
  const artifact: Artifact = {
    id: `art-${now}-${Math.random().toString(36).slice(2, 8)}`,
    workspaceId,
    type: input.type,
    title: input.title || 'Untitled artifact',
    versions: [
      {
        id: versionId,
        content: input.content,
        prompt: input.prompt,
        createdAt: now,
      },
    ],
    currentVersionId: versionId,
    source: input.source,
    createdAt: now,
    updatedAt: now,
  };
  all.push(artifact);
  await writeArtifacts(workspaceId, all);
  broadcast({ workspaceId, artifactId: artifact.id, kind: 'create' });
  return artifact;
}

export async function addArtifactVersion(
  workspaceId: string,
  artifactId: string,
  input: { content: string; prompt?: string },
): Promise<Artifact | null> {
  const all = await readArtifacts(workspaceId);
  const idx = all.findIndex(a => a.id === artifactId);
  if (idx === -1) return null;
  const now = Date.now();
  const versionId = randomUUID();
  const updated: Artifact = {
    ...all[idx],
    versions: [...all[idx].versions, { id: versionId, content: input.content, prompt: input.prompt, createdAt: now }],
    currentVersionId: versionId,
    updatedAt: now,
  };
  all[idx] = updated;
  await writeArtifacts(workspaceId, all);
  broadcast({ workspaceId, artifactId, kind: 'update' });
  return updated;
}

export async function updateArtifact(
  workspaceId: string,
  artifactId: string,
  patch: Partial<Pick<Artifact, 'title' | 'currentVersionId' | 'pinnedNodeId'>>,
): Promise<Artifact | null> {
  const all = await readArtifacts(workspaceId);
  const idx = all.findIndex(a => a.id === artifactId);
  if (idx === -1) return null;
  // If currentVersionId is patched, verify it actually exists.
  if (patch.currentVersionId && !all[idx].versions.some(v => v.id === patch.currentVersionId)) {
    return all[idx];
  }
  const updated: Artifact = {
    ...all[idx],
    ...patch,
    updatedAt: Date.now(),
  };
  all[idx] = updated;
  await writeArtifacts(workspaceId, all);
  broadcast({ workspaceId, artifactId, kind: 'update' });
  return updated;
}

export async function deleteArtifact(workspaceId: string, artifactId: string): Promise<boolean> {
  const all = await readArtifacts(workspaceId);
  const next = all.filter(a => a.id !== artifactId);
  if (next.length === all.length) return false;
  await writeArtifacts(workspaceId, next);
  broadcast({ workspaceId, artifactId, kind: 'delete' });
  return true;
}

/**
 * Helper for callers (eg the agent tool) — returns the live content for the
 * current version, or `null` if either the artifact or its current version
 * is missing.
 */
export async function getCurrentVersionContent(
  workspaceId: string,
  artifactId: string,
): Promise<{ content: string; type: ArtifactType; title: string } | null> {
  const artifact = await getArtifact(workspaceId, artifactId);
  if (!artifact) return null;
  const version = artifact.versions.find(v => v.id === artifact.currentVersionId)
    ?? artifact.versions[artifact.versions.length - 1];
  if (!version) return null;
  return { content: version.content, type: artifact.type, title: artifact.title };
}
