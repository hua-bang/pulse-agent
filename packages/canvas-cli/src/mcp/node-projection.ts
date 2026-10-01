import { createHash } from 'crypto';
import { getWorkspaceDir, loadCanvas, loadWorkspaceManifest, listWorkspaceIds } from '../core/store';
import { readNode, writableDataFields } from '../core/nodes';
import type { CanvasNode } from '../core/types';

/**
 * Single-node projection for the MCP App node view (built by
 * apps/canvas-workspace from the app's own node bodies). Only the fields
 * those bodies render are sent; heavy or sensitive data (absolute file
 * paths, iframe html, plugin payloads, scrollback) never leaves the store.
 */

/** Max characters of a file note sent to the view (it is read-only there). */
export const NODE_VIEW_FILE_LIMIT = 200_000;

export interface ViewNode {
  id: string;
  type: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  updatedAt?: number;
  data: Record<string, unknown>;
}

export interface NodeViewPayload {
  workspaceId: string;
  workspaceName: string;
  node: ViewNode;
  /** Opaque change token for this node; the view polls it. */
  version: string;
  /** `data` fields `canvas_apply` accepts for this node (empty: read-only). */
  writableFields: string[];
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  active: boolean;
}

export async function listWorkspaceSummaries(storeDir?: string): Promise<WorkspaceSummary[]> {
  const ids = await listWorkspaceIds(storeDir);
  const manifest = await loadWorkspaceManifest(storeDir);
  const names = new Map((manifest.workspaces ?? []).map(entry => [entry.id, entry.name]));
  return ids.map(id => ({ id, name: names.get(id) ?? id, active: id === manifest.activeId }));
}

export async function workspaceName(workspaceId: string, storeDir?: string): Promise<string> {
  const manifest = await loadWorkspaceManifest(storeDir);
  return (manifest.workspaces ?? []).find(entry => entry.id === workspaceId)?.name ?? workspaceId;
}

async function projectData(node: CanvasNode, confineToDir: string): Promise<Record<string, unknown>> {
  if (node.type === 'file') {
    const read = await readNode(node, { confineToDir });
    const content = String(read.content ?? '');
    return {
      content: content.slice(0, NODE_VIEW_FILE_LIMIT),
      ...(content.length > NODE_VIEW_FILE_LIMIT ? { contentTruncated: true } : {}),
    };
  }
  const data: Record<string, unknown> = {};
  for (const field of writableDataFields(node.type)) {
    if (node.data[field] !== undefined) data[field] = node.data[field];
  }
  return data;
}

export async function findCanvasNode(
  workspaceId: string,
  nodeId: string,
  storeDir?: string,
): Promise<{ found: true; node: CanvasNode } | { found: false; code: string }> {
  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) return { found: false, code: 'workspace_not_found' };
  const node = canvas.nodes.find(candidate => candidate.id === nodeId);
  return node ? { found: true, node } : { found: false, code: 'node_not_found' };
}

export async function buildNodeView(
  workspaceId: string,
  node: CanvasNode,
  storeDir?: string,
): Promise<NodeViewPayload> {
  const view: ViewNode = {
    id: node.id,
    type: node.type,
    title: node.title ?? '',
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    updatedAt: node.updatedAt,
    data: await projectData(node, getWorkspaceDir(workspaceId, storeDir)),
  };
  return {
    workspaceId,
    workspaceName: await workspaceName(workspaceId, storeDir),
    node: view,
    version: createHash('sha1').update(JSON.stringify(view)).digest('hex'),
    writableFields: writableDataFields(node.type),
  };
}
