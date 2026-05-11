/**
 * IPC handlers for the workspace artifact store.
 *
 * Channels:
 *   artifact:list         (workspaceId)                          → Artifact[]
 *   artifact:get          (workspaceId, artifactId)              → Artifact | null
 *   artifact:create       (workspaceId, input)                   → Artifact
 *   artifact:add-version  (workspaceId, artifactId, input)       → Artifact
 *   artifact:update       (workspaceId, artifactId, patch)       → Artifact
 *   artifact:delete       (workspaceId, artifactId)              → boolean
 *   artifact:pin-to-canvas (workspaceId, artifactId, placement)  → { nodeId, artifact }
 *
 * Plus a broadcast channel `artifact:change` for renderer subscriptions
 * (fired from artifact-store.ts directly).
 */

import { ipcMain } from 'electron';
import { promises as fs } from 'fs';
import { dirname, basename, join } from 'path';
import { getWorkspaceDir } from './canvas-store';
import {
  addArtifactVersion,
  createArtifact,
  deleteArtifact,
  getArtifact,
  listArtifacts,
  updateArtifact,
  type Artifact,
  type ArtifactType,
} from './artifact-store';
import { broadcastCanvasUpdate } from './canvas-broadcast';

const BLANK_PAGE_URL = 'about:blank';

interface PinPlacement {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  title?: string;
}

interface CanvasNode {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  data: Record<string, unknown>;
  updatedAt?: number;
}

interface CanvasSaveData {
  nodes: CanvasNode[];
  edges?: unknown[];
  transform: { x: number; y: number; scale: number };
  savedAt: string;
}

function canvasPath(workspaceId: string): string {
  return join(getWorkspaceDir(workspaceId), 'canvas.json');
}

async function atomicWrite(finalPath: string, body: string): Promise<void> {
  const dir = dirname(finalPath);
  const tmp = join(dir, `${basename(finalPath)}.tmp`);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmp, body, 'utf-8');
  await fs.rename(tmp, finalPath);
}

async function loadCanvas(workspaceId: string): Promise<CanvasSaveData | null> {
  try {
    const raw = await fs.readFile(canvasPath(workspaceId), 'utf-8');
    const data = JSON.parse(raw) as CanvasSaveData;
    data.nodes = data.nodes ?? [];
    return data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
}

function autoPlace(nodes: CanvasNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 100, y: 100 };
  let maxRight = 0;
  let bestY = 100;
  for (const n of nodes) {
    const right = n.x + n.width;
    if (right > maxRight) {
      maxRight = right;
      bestY = n.y;
    }
  }
  return { x: maxRight + 40, y: bestY };
}

/**
 * Pin an artifact to the canvas by creating an iframe node whose
 * `data.artifactId` references it. The node renders the artifact's current
 * version live — bumping the artifact updates the node automatically.
 *
 * Exported so the canvas-agent's `artifact_pin_to_canvas` tool can call
 * the same code path as the renderer-side "Pin to Canvas" button.
 */
export async function pinArtifactToCanvas(
  workspaceId: string,
  artifactId: string,
  placement: PinPlacement = {},
): Promise<{ nodeId: string; artifact: Artifact } | { error: string }> {
  const artifact = await getArtifact(workspaceId, artifactId);
  if (!artifact) return { error: `Artifact not found: ${artifactId}` };

  const canvas = await loadCanvas(workspaceId);
  if (!canvas) {
    // Fresh workspace — bootstrap an empty canvas. Same shape canvas-store
    // creates on first save; safe because we're adding our node immediately.
    const bootstrap: CanvasSaveData = {
      nodes: [],
      edges: [],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: new Date().toISOString(),
    };
    return await writeWithNewNode(workspaceId, bootstrap, artifact, placement);
  }
  return await writeWithNewNode(workspaceId, canvas, artifact, placement);
}

async function writeWithNewNode(
  workspaceId: string,
  canvas: CanvasSaveData,
  artifact: Artifact,
  placement: PinPlacement,
): Promise<{ nodeId: string; artifact: Artifact }> {
  const nodeId = `node-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const pos = (placement.x != null && placement.y != null)
    ? { x: placement.x, y: placement.y }
    : autoPlace(canvas.nodes);

  const node: CanvasNode = {
    id: nodeId,
    type: 'iframe',
    title: placement.title ?? artifact.title ?? 'Artifact',
    x: pos.x,
    y: pos.y,
    width: placement.width ?? 520,
    height: placement.height ?? 400,
    data: {
      url: BLANK_PAGE_URL,
      mode: 'artifact',
      artifactId: artifact.id,
    },
    updatedAt: Date.now(),
  };

  canvas.nodes.push(node);
  canvas.savedAt = new Date().toISOString();
  await atomicWrite(canvasPath(workspaceId), JSON.stringify(canvas, null, 2));

  // Mark artifact as pinned (best-effort — failure here doesn't undo the node).
  const updated = await updateArtifact(workspaceId, artifact.id, { pinnedNodeId: nodeId }) ?? artifact;

  broadcastCanvasUpdate(workspaceId, [nodeId]);
  return { nodeId, artifact: updated };
}

export function setupArtifactIpc(): void {
  ipcMain.handle('artifact:list', async (_event, payload: { workspaceId: string }) => {
    try {
      const artifacts = await listArtifacts(payload.workspaceId);
      return { ok: true, artifacts };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('artifact:get', async (_event, payload: { workspaceId: string; artifactId: string }) => {
    try {
      const artifact = await getArtifact(payload.workspaceId, payload.artifactId);
      return { ok: true, artifact: artifact ?? undefined };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('artifact:create', async (_event, payload: {
    workspaceId: string;
    input: { type: ArtifactType; title: string; content: string; prompt?: string; source?: Artifact['source'] };
  }) => {
    try {
      const artifact = await createArtifact(payload.workspaceId, payload.input);
      return { ok: true, artifact };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('artifact:add-version', async (_event, payload: {
    workspaceId: string;
    artifactId: string;
    input: { content: string; prompt?: string };
  }) => {
    try {
      const artifact = await addArtifactVersion(payload.workspaceId, payload.artifactId, payload.input);
      if (!artifact) return { ok: false, error: 'Artifact not found' };
      return { ok: true, artifact };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('artifact:update', async (_event, payload: {
    workspaceId: string;
    artifactId: string;
    patch: Partial<Pick<Artifact, 'title' | 'currentVersionId' | 'pinnedNodeId'>>;
  }) => {
    try {
      const artifact = await updateArtifact(payload.workspaceId, payload.artifactId, payload.patch);
      if (!artifact) return { ok: false, error: 'Artifact not found' };
      return { ok: true, artifact };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('artifact:delete', async (_event, payload: { workspaceId: string; artifactId: string }) => {
    try {
      const ok = await deleteArtifact(payload.workspaceId, payload.artifactId);
      return { ok };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('artifact:pin-to-canvas', async (_event, payload: {
    workspaceId: string;
    artifactId: string;
    placement?: PinPlacement;
  }) => {
    try {
      const result = await pinArtifactToCanvas(payload.workspaceId, payload.artifactId, payload.placement ?? {});
      if ('error' in result) return { ok: false, error: result.error };
      return { ok: true, nodeId: result.nodeId, artifact: result.artifact };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
