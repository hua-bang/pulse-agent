/**
 * Workspace-node IPC surface:
 * - workspace-node:list / read
 * - workspace-node:tags / upsert-tag
 * - workspace-node:update / update-tags
 * - workspace-node:apply-proposal
 */
import { ipcMain } from 'electron';
import {
  listWorkspaceNodes,
  mutateWorkspaceNode,
  readWorkspaceNode,
  type WorkspaceNodeRecord,
} from './store';
import { readKnowledgeTags, upsertKnowledgeTag, type KnowledgeTagDefinition } from './tags';
import { broadcastWorkspaceNodesChanged, scheduleWorkspaceNodesChanged } from './broadcast';
import { applyKnowledgeChangeProposal } from './knowledge-change';
import { isKnowledgeChangeProposal } from '../../../shared/knowledge-change';
import type { WorkspaceNodeListItem } from '../../../shared/canvas';
import { readCanvasFull } from '../storage';

export type { WorkspaceNodeListItem } from '../../../shared/canvas';

interface CanvasNodeLite {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  data?: Record<string, unknown>;
}

type WorkspaceNodeUpdateResult =
  | { ok: true; node: WorkspaceNodeRecord }
  | { ok: false; error: string };

/**
 * Canvas nodes (by id) for a workspace. Returns null when canvas.json is
 * missing/unreadable so callers can treat membership as "unknown" (and avoid
 * hiding everything) rather than "off-canvas".
 */
async function loadCanvasNodes(workspaceId: string): Promise<Map<string, CanvasNodeLite> | null> {
  try {
    const { data } = await readCanvasFull(workspaceId);
    if (!data || !Array.isArray(data.nodes)) return null;
    const map = new Map<string, CanvasNodeLite>();
    for (const node of data.nodes as CanvasNodeLite[]) {
      if (node && typeof node.id === 'string' && node.id) map.set(node.id, node);
    }
    return map;
  } catch {
    return null;
  }
}

/**
 * Strip HTML tags + decode a minimal set of entities and collapse whitespace.
 * Text/iframe nodes keep tiptap/HTML in `data`, so a raw preview would show
 * "<p>…" / "<strong>…" / "&gt;" — this turns it into readable prose.
 */
function stripHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Short, de-marked, HTML-stripped preview — for nodes that keep prose in `data`. */
function firstLinePreview(content: unknown, max = 48): string {
  if (typeof content !== 'string') return '';
  const text = stripHtml(content);
  if (!text) return '';
  const stripped = text
    .replace(/^#{1,6}\s+/, '')
    .replace(/^[-*+]\s+/, '')
    .replace(/^>\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .trim();
  if (!stripped) return '';
  return stripped.length <= max ? stripped : `${stripped.slice(0, max)}…`;
}

/**
 * A meaningful label. `text` / `mindmap` nodes carry no real title (the content
 * lives in `data`), and the knowledge record often has only the bare type word
 * ("Text") or nothing — so derive from the canvas node when needed.
 */
function deriveDisplayTitle(record: WorkspaceNodeRecord, canvasNode: CanvasNodeLite | undefined): string | undefined {
  const type = (typeof canvasNode?.type === 'string' ? canvasNode.type : undefined) ?? record.type;
  const data = (canvasNode?.data ?? record.data ?? {}) as Record<string, unknown>;
  const recTitle = record.title?.trim();
  const canvasTitle = typeof canvasNode?.title === 'string' ? canvasNode.title.trim() : '';

  // Once the user gives the node a real title, it is the stable identity shown
  // everywhere. Type placeholders such as "Text" still fall back to content.
  if (recTitle && recTitle.toLowerCase() !== type.toLowerCase()) return recTitle;
  if (canvasTitle && canvasTitle.toLowerCase() !== type.toLowerCase()) return canvasTitle;

  if (type === 'text') {
    const preview = firstLinePreview(data.content);
    if (preview) return preview;
  }
  if (type === 'mindmap') {
    const root = data.root as { text?: unknown } | undefined;
    const rootText = typeof root?.text === 'string' ? root.text.trim() : '';
    if (rootText) return rootText;
  }

  return recTitle || canvasTitle || undefined;
}

function stringFromUnknown(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function tagsFromRecord(record: WorkspaceNodeRecord): string[] {
  const raw = record.properties?.tags;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function summaryFromRecord(record: WorkspaceNodeRecord): string {
  const propertySummary = stringFromUnknown(record.properties?.summary);
  if (propertySummary) return propertySummary;

  const content = stringFromUnknown(record.data.content);
  if (content) return content;

  const scrollback = stringFromUnknown(record.data.scrollback);
  if (scrollback) return scrollback;

  const url = stringFromUnknown(record.data.url);
  if (url) return url;

  const filePath = stringFromUnknown(record.data.filePath);
  if (filePath) return filePath;

  return '';
}

function toListItem(record: WorkspaceNodeRecord, canvasNodes: Map<string, CanvasNodeLite> | null): WorkspaceNodeListItem {
  const canvasNode = canvasNodes?.get(record.id);
  // The record's own data is often empty (e.g. tag-only records), so fall back
  // to the canvas node's content for a useful summary.
  const canvasContent = stringFromUnknown(canvasNode?.data?.content);
  const rawSummary =
    summaryFromRecord(record) || canvasContent || stringFromUnknown(canvasNode?.data?.url);
  const summary = stripHtml(rawSummary).slice(0, 160);
  const previewPath = record.type === 'image'
    ? stringFromUnknown(record.data.filePath) || stringFromUnknown(canvasNode?.data?.filePath)
    : '';
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    displayTitle: deriveDisplayTitle(record, canvasNode),
    summary,
    ...(previewPath ? { previewPath } : {}),
    tags: tagsFromRecord(record),
    links: record.links ?? [],
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
    hasData: Object.keys(record.data ?? {}).length > 0,
    linkCount: Array.isArray(record.links) ? record.links.length : 0,
    // Unknown (canvas unreadable) → treat as on-canvas so we never hide
    // everything; only a real, loaded canvas can mark a record off-canvas.
    onCanvas: canvasNodes ? canvasNodes.has(record.id) : true,
  };
}

function mergeTagDefinitions(
  explicitTags: KnowledgeTagDefinition[],
  records: WorkspaceNodeRecord[],
): KnowledgeTagDefinition[] {
  const byId = new Map<string, KnowledgeTagDefinition>();
  for (const tag of explicitTags) {
    byId.set(tag.id, tag);
  }
  for (const record of records) {
    for (const tagId of tagsFromRecord(record)) {
      if (byId.has(tagId)) continue;
      byId.set(tagId, { id: tagId, name: tagId });
    }
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function setupWorkspaceNodeIpc(): void {
  ipcMain.handle('workspace-node:list', async (_event, payload: { workspaceId: string }) => {
    try {
      if (!payload.workspaceId) return { ok: false, error: 'Missing workspace id.' };
      const records = await listWorkspaceNodes(payload.workspaceId);
      const tags = await readKnowledgeTags();
      const canvasNodes = await loadCanvasNodes(payload.workspaceId);
      return {
        ok: true,
        nodes: records.map((record) => toListItem(record, canvasNodes)),
        tags: mergeTagDefinitions(tags, records),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace-node:read', async (_event, payload: { workspaceId: string; nodeId: string }) => {
    try {
      if (!payload.workspaceId) return { ok: false, error: 'Missing workspace id.' };
      if (!payload.nodeId) return { ok: false, error: 'Missing node id.' };
      const node = await readWorkspaceNode(payload.workspaceId, payload.nodeId);
      return { ok: true, node };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace-node:tags', async () => {
    try {
      return { ok: true, tags: await readKnowledgeTags() };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace-node:upsert-tag', async (_event, payload: { tag: Partial<KnowledgeTagDefinition> & { name: string } }) => {
    try {
      const tag = await upsertKnowledgeTag(payload.tag);
      return { ok: true, tag };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace-node:update', async (_event, payload: {
    workspaceId: string;
    nodeId: string;
    patch: Partial<WorkspaceNodeRecord>;
  }) => {
    try {
      if (!payload.workspaceId) return { ok: false, error: 'Missing workspace id.' };
      if (!payload.nodeId) return { ok: false, error: 'Missing node id.' };
      const patch = payload.patch ?? {};
      const result = await mutateWorkspaceNode<WorkspaceNodeUpdateResult>(payload.workspaceId, payload.nodeId, (existing) => {
        if (!existing) return { result: { ok: false, error: 'Node not found.' } };
        const next: WorkspaceNodeRecord = {
          ...existing,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          data: patch.data !== undefined
            ? { ...(existing.data ?? {}), ...patch.data }
            : existing.data,
          properties: patch.properties !== undefined
            ? { ...(existing.properties ?? {}), ...patch.properties }
            : existing.properties,
          links: patch.links !== undefined ? patch.links : existing.links,
          updatedAt: Date.now(),
        };
        return { record: next, result: { ok: true, node: next } };
      });
      if (result.ok) scheduleWorkspaceNodesChanged([payload.workspaceId]);
      return result;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace-node:update-tags', async (_event, payload: { workspaceId: string; nodeId: string; tags: string[] }) => {
    try {
      if (!payload.workspaceId) return { ok: false, error: 'Missing workspace id.' };
      if (!payload.nodeId) return { ok: false, error: 'Missing node id.' };
      const tags = Array.from(new Set(
        (Array.isArray(payload.tags) ? payload.tags : [])
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim())
          .filter(Boolean),
      ));
      const result = await mutateWorkspaceNode<WorkspaceNodeUpdateResult>(payload.workspaceId, payload.nodeId, (node) => {
        if (!node) return { result: { ok: false, error: 'Node not found.' } };
        const next: WorkspaceNodeRecord = {
          ...node,
          properties: {
            ...node.properties,
            tags,
          },
          updatedAt: Date.now(),
        };
        return { record: next, result: { ok: true, node: next } };
      });
      if (result.ok) broadcastWorkspaceNodesChanged([payload.workspaceId], 'renderer');
      return result;
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace-node:apply-proposal', async (_event, payload: { proposal: unknown }) => {
    if (!isKnowledgeChangeProposal(payload?.proposal)) {
      return { ok: false, code: 'invalid', error: 'Invalid node change proposal.' };
    }
    const result = await applyKnowledgeChangeProposal(payload.proposal);
    if (result.ok) {
      broadcastWorkspaceNodesChanged([result.workspaceId], 'renderer');
    }
    return result;
  });
}
