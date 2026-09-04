import type { Dirent } from 'fs';
import { promises as fs } from 'fs';
import type { WorkspaceNodeRecord } from '../nodes/store';
import { isEnoent } from './atomic-json';
import {
  MANIFEST_ID,
  STORE_DIR,
  getCanvasJsonPath,
  getNodeFilePath,
  isSafeNodeId,
} from './paths';
import {
  detectSchemaVersion,
  type CanvasNode,
  type CanvasSaveData,
} from './schema';

export class CanvasPollutionDetectedError extends Error {
  readonly workspaceId: string;
  readonly conflictingNodeIds: string[];

  constructor(workspaceId: string, conflictingNodeIds: string[]) {
    const sample = conflictingNodeIds.slice(0, 5).join(', ');
    const more = conflictingNodeIds.length > 5
      ? `, +${conflictingNodeIds.length - 5} more`
      : '';
    super(
      `[canvas-storage] refusing v1-shape write/migration for workspace ` +
      `"${workspaceId}": ${conflictingNodeIds.length} node id(s) already ` +
      `have v2 per-node files on disk (${sample}${more}). This is the ` +
      `signature of a v1-unaware writer (old binary or external script) ` +
      `having clobbered canvas.json. The real data is still in the ` +
      `nodes/<id>.json files — do NOT migrate, restore canvas.json ` +
      `instead (see docs).`,
    );
    this.name = 'CanvasPollutionDetectedError';
    this.workspaceId = workspaceId;
    this.conflictingNodeIds = conflictingNodeIds;
  }
}

const dataNonEmpty = (data: unknown): boolean =>
  !!data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data as object).length > 0;

export async function detectV1Pollution(
  workspaceId: string,
  incomingNodes: CanvasNode[] | undefined,
  root: string = STORE_DIR,
): Promise<string[]> {
  if (!Array.isArray(incomingNodes) || incomingNodes.length === 0) return [];

  const byId = new Map<string, CanvasNode>();
  for (const node of incomingNodes) {
    if (typeof node.id === 'string' && isSafeNodeId(node.id)) byId.set(node.id, node);
  }
  if (byId.size === 0) return [];

  const conflicts: string[] = [];
  await Promise.all(
    [...byId.entries()].map(async ([id, incoming]) => {
      if (dataNonEmpty(incoming.data)) return;

      let onDisk: WorkspaceNodeRecord;
      try {
        const raw = await fs.readFile(getNodeFilePath(workspaceId, id, root), 'utf-8');
        onDisk = JSON.parse(raw) as WorkspaceNodeRecord;
      } catch {
        return;
      }
      const linksNonEmpty = Array.isArray(onDisk.links) && onDisk.links.length > 0;
      if (!dataNonEmpty(onDisk.data) && !linksNonEmpty) return;

      conflicts.push(id);
    }),
  );
  return conflicts;
}

export async function scanForPollutedWorkspaces(
  root: string = STORE_DIR,
): Promise<Array<{ workspaceId: string; conflictingNodeIds: string[] }>> {
  let entries: Dirent[];
  try {
    entries = (await fs.readdir(root, { withFileTypes: true })) as Dirent[];
  } catch (err) {
    if (isEnoent(err)) return [];
    throw err;
  }

  const findings: Array<{ workspaceId: string; conflictingNodeIds: string[] }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === MANIFEST_ID) continue;
    const workspaceId = entry.name;

    let parsed: CanvasSaveData;
    try {
      const raw = await fs.readFile(getCanvasJsonPath(workspaceId, root), 'utf-8');
      parsed = JSON.parse(raw) as CanvasSaveData;
    } catch {
      continue;
    }

    if (detectSchemaVersion(parsed) === 2) continue;
    const conflicts = await detectV1Pollution(workspaceId, parsed.nodes, root);
    if (conflicts.length > 0) {
      findings.push({ workspaceId, conflictingNodeIds: conflicts });
    }
  }
  return findings;
}
