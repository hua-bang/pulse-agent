import { mutateWorkspaceNode } from '../nodes/store';
import { atomicWriteJson } from './atomic-json';
import { getCanvasJsonPath, isSafeNodeId } from './paths';
import { CANVAS_SCHEMA_VERSION_V2, PER_NODE_SCHEMA_VERSION, type CanvasNode, type CanvasSaveData, type PerNodeFile } from './schema';

export async function writeCanvasFullV2(
  workspaceId: string,
  data: CanvasSaveData,
  root: string,
): Promise<void> {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const now = Date.now();

  // 1. Write per-node files for every node. Use updatedAt arbitration: if
  //    the on-disk per-node file is newer, keep it (defends against a stale
  //    in-memory snapshot clobbering a fresh CLI-side edit).
  for (const node of nodes) {
    const nodeId = node.id;
    if (!nodeId || !isSafeNodeId(nodeId)) continue;
    if (isLayoutOnlyReferenceNode(node)) continue;

    await mutateWorkspaceNode(workspaceId, nodeId, (existing) => {
      const incomingUpdatedAt = typeof node.updatedAt === 'number' ? node.updatedAt : now;
      const existingUpdatedAt = existing && typeof existing.updatedAt === 'number' ? existing.updatedAt : 0;

      if (existing && existingUpdatedAt > incomingUpdatedAt) {
        // Disk is newer — preserve it. This arbitration runs under the same
        // per-node lock as proposal and IPC mutations, so a stale full save
        // cannot read before a mutation and write after it.
        return { result: undefined };
      }

      const file: PerNodeFile = {
        schemaVersion: PER_NODE_SCHEMA_VERSION,
        id: nodeId,
        type: node.type,
        title: node.title,
        data: (node.data ?? {}) as Record<string, unknown>,
        properties: node.properties ?? existing?.properties,
        links: node.links ?? existing?.links,
        updatedAt: incomingUpdatedAt,
        createdAt: existing?.createdAt ?? incomingUpdatedAt,
      };
      return { record: file, result: undefined };
    }, root);
  }

  // 2. Do not delete per-node files omitted from the incoming layout. In v2,
  //    nodes/<id>.json is treated as the workspace-scoped atom store; a
  //    canvas save only updates the current layout projection. Orphan cleanup
  //    should be an explicit atom-store operation, not a side effect of saving
  //    a canvas view.

  // 3. Construct the v2 layout: strip data, keep everything else.
  const layout: CanvasSaveData = {
    ...data,
    schemaVersion: 2,
    nodes: nodes.map((n) => stripDataFromNode(n)),
  };

  // 4. COMMIT POINT — atomic canvas.json swap. Rolling backup of the
  //    previous v2 file rotates here.
  await atomicWriteJson(
    getCanvasJsonPath(workspaceId, root),
    JSON.stringify(layout, null, 2),
    { rollingBackup: true },
  );
}

export function stripDataFromNode(node: CanvasNode): CanvasNode {
  if (isLayoutOnlyReferenceNode(node)) return node;
  const { data: _data, properties: _properties, links: _links, ...rest } = node;
  return rest;
}

export function isLayoutOnlyReferenceNode(node: CanvasNode): boolean {
  return !!node
    && typeof node === 'object'
    && node.type === 'reference'
    && node.ref != null;
}
