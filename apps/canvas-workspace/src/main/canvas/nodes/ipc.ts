import { ipcMain } from 'electron';
import {
  listWorkspaceNodes,
  readWorkspaceNode,
  writeWorkspaceNode,
  type WorkspaceNodeRecord,
} from './store';
import { readKnowledgeTags, upsertKnowledgeTag, type KnowledgeTagDefinition } from './tags';
import { readCanvasFull } from '../storage';

export interface WorkspaceNodeListItem {
  id: string;
  type: string;
  title?: string;
  summary?: string;
  tags: string[];
  links: WorkspaceNodeRecord['links'];
  updatedAt?: number;
  createdAt?: number;
  hasData: boolean;
  linkCount: number;
  /** Friendlier label derived from the canvas node (text content preview, mindmap root, ...). */
  displayTitle?: string;
  /** Whether a canvas node with this id currently exists in the workspace. */
  onCanvas?: boolean;
}

interface CanvasNodeLite {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  data?: Record<string, unknown>;
}

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

/** First non-empty line, lightly de-marked and capped — for nodes that keep prose in `data`. */
function firstLinePreview(content: unknown, max = 48): string {
  if (typeof content !== 'string') return '';
  const line = content.split(/\r?\n/).map((s) => s.trim()).find((s) => s.length > 0);
  if (!line) return '';
  const stripped = line
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

  if (type === 'text') {
    const preview = firstLinePreview(data.content);
    if (preview) return preview;
  }
  if (type === 'mindmap') {
    const root = data.root as { text?: unknown } | undefined;
    const rootText = typeof root?.text === 'string' ? root.text.trim() : '';
    if (rootText) return rootText;
  }

  const recTitle = record.title?.trim();
  if (recTitle && recTitle.toLowerCase() !== type.toLowerCase()) return recTitle;
  const canvasTitle = typeof canvasNode?.title === 'string' ? canvasNode.title.trim() : '';
  if (canvasTitle && canvasTitle.toLowerCase() !== type.toLowerCase()) return canvasTitle;
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
  const summary =
    summaryFromRecord(record) ||
    (canvasContent ? canvasContent.replace(/\s+/g, ' ').trim().slice(0, 160) : '') ||
    stringFromUnknown(canvasNode?.data?.url);
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    displayTitle: deriveDisplayTitle(record, canvasNode),
    summary,
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
      const existing = await readWorkspaceNode(payload.workspaceId, payload.nodeId);
      if (!existing) return { ok: false, error: 'Node not found.' };
      const patch = payload.patch ?? {};
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
      await writeWorkspaceNode(payload.workspaceId, next);
      return { ok: true, node: next };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('workspace-node:update-tags', async (_event, payload: { workspaceId: string; nodeId: string; tags: string[] }) => {
    try {
      if (!payload.workspaceId) return { ok: false, error: 'Missing workspace id.' };
      if (!payload.nodeId) return { ok: false, error: 'Missing node id.' };
      const node = await readWorkspaceNode(payload.workspaceId, payload.nodeId);
      if (!node) return { ok: false, error: 'Node not found.' };
      const tags = Array.from(new Set(
        (Array.isArray(payload.tags) ? payload.tags : [])
          .filter((tag): tag is string => typeof tag === 'string')
          .map((tag) => tag.trim())
          .filter(Boolean),
      ));
      const next: WorkspaceNodeRecord = {
        ...node,
        properties: {
          ...node.properties,
          tags,
        },
        updatedAt: Date.now(),
      };
      await writeWorkspaceNode(payload.workspaceId, next);
      return { ok: true, node: next };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
