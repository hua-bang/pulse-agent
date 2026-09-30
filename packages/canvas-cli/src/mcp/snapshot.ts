import { loadCanvas, loadWorkspaceManifest, listWorkspaceIds, getWorkspaceDir } from '../core/store';
import { readNode } from '../core/nodes';
import type { CanvasEdge, CanvasNode, CanvasSaveData, MindmapTopic } from '../core/types';
import type { CanvasSnapshot, ViewEdge, ViewNode, WorkspaceSummary } from './view-types';

export type { CanvasSnapshot, ViewEdge, ViewNode, WorkspaceSummary };

/**
 * Render-oriented projection of a canvas for the MCP App view.
 *
 * The view never sees raw `CanvasSaveData`: heavy or sensitive fields
 * (iframe html, plugin payloads, terminal scrollback) are dropped, long
 * bodies are capped, and every node carries an explicit `editable` mode so
 * the view cannot offer an edit the store would reject or truncate.
 */

/** Max characters of a file/text body sent to the view. */
export const SNAPSHOT_CONTENT_LIMIT = 20_000;

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

/**
 * Cheap change token. Legacy JSON only bumps `revision` on CLI writes, so the
 * token also folds in `savedAt` and the freshest node/edge `updatedAt`, which
 * the app stamps on its own saves.
 */
export function canvasVersion(canvas: CanvasSaveData): string {
  let latest = 0;
  for (const node of canvas.nodes) latest = Math.max(latest, node.updatedAt ?? 0);
  for (const edge of canvas.edges ?? []) latest = Math.max(latest, edge.updatedAt ?? 0);
  return [
    canvas.storageGeneration ?? '',
    canvas.revision ?? '',
    canvas.savedAt ?? '',
    canvas.nodes.length,
    canvas.edges?.length ?? 0,
    latest,
  ].join(':');
}

function flattenOutline(topic: MindmapTopic | undefined, depth = 0): string[] {
  if (!topic) return [];
  const lines = [`${'  '.repeat(depth)}- ${topic.text?.trim() || '(empty)'}`];
  for (const child of topic.children ?? []) lines.push(...flattenOutline(child, depth + 1));
  return lines;
}

function cap(text: string): { content: string; contentTruncated?: boolean } {
  return text.length > SNAPSHOT_CONTENT_LIMIT
    ? { content: text.slice(0, SNAPSHOT_CONTENT_LIMIT), contentTruncated: true }
    : { content: text };
}

function stringField(data: Record<string, unknown>, key: string): string | undefined {
  const value = data[key];
  return typeof value === 'string' && value ? value : undefined;
}

function baseName(path: string | undefined): string | undefined {
  return path ? path.split(/[\\/]/).pop() : undefined;
}

async function projectNode(node: CanvasNode, confineToDir: string): Promise<ViewNode> {
  const view: ViewNode = {
    id: node.id,
    type: node.type,
    title: node.title ?? '',
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    editable: 'none',
  };
  const data = node.data ?? {};
  switch (node.type) {
    case 'file': {
      const read = await readNode(node, { confineToDir });
      Object.assign(view, cap(String(read.content ?? '')));
      view.meta = baseName(node.data.filePath);
      view.editable = read.pathConfined || view.contentTruncated ? 'none' : 'content';
      break;
    }
    case 'text':
      Object.assign(view, cap(stringField(data, 'content') ?? stringField(data, 'text') ?? ''));
      view.color = stringField(data, 'color');
      view.editable = view.contentTruncated ? 'none' : 'content';
      break;
    case 'frame':
    case 'group':
      view.label = stringField(data, 'label') ?? '';
      view.color = stringField(data, 'color');
      view.editable = 'label';
      break;
    case 'mindmap':
      view.outline = flattenOutline(data.root as MindmapTopic | undefined).join('\n');
      break;
    case 'shape':
      view.content = stringField(data, 'text');
      view.color = stringField(data, 'fill') ?? stringField(data, 'color');
      view.meta = stringField(data, 'shape') ?? stringField(data, 'shapeType');
      break;
    case 'image':
      view.meta = baseName(stringField(data, 'filePath')) ?? stringField(data, 'alt');
      break;
    case 'iframe':
      view.meta = stringField(data, 'pageTitle') ?? stringField(data, 'url');
      break;
    case 'dynamic-app':
      view.meta = stringField(data, 'url');
      break;
    case 'plugin':
      view.meta = stringField(data, 'nodeType') ?? stringField(data, 'pluginId');
      break;
    case 'terminal':
    case 'agent':
      view.meta = stringField(data, 'cwd');
      break;
    default:
      break;
  }
  return view;
}

function projectEdge(edge: CanvasEdge): ViewEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    color: edge.stroke?.color,
    width: edge.stroke?.width,
    style: edge.stroke?.style,
    arrowHead: edge.arrowHead,
    arrowTail: edge.arrowTail,
  };
}

export async function buildSnapshot(
  workspaceId: string,
  storeDir?: string,
): Promise<CanvasSnapshot | null> {
  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) return null;
  const confineToDir = getWorkspaceDir(workspaceId, storeDir);
  const nodes: ViewNode[] = [];
  for (const node of canvas.nodes) nodes.push(await projectNode(node, confineToDir));
  return {
    workspaceId,
    workspaceName: await workspaceName(workspaceId, storeDir),
    version: canvasVersion(canvas),
    revision: typeof canvas.revision === 'number' ? canvas.revision : null,
    nodes,
    edges: (canvas.edges ?? []).map(projectEdge),
  };
}

export async function readCanvasVersion(
  workspaceId: string,
  storeDir?: string,
): Promise<{ version: string; revision: number | null } | null> {
  const canvas = await loadCanvas(workspaceId, storeDir);
  if (!canvas) return null;
  return {
    version: canvasVersion(canvas),
    revision: typeof canvas.revision === 'number' ? canvas.revision : null,
  };
}
