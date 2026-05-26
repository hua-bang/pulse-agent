import { ipcMain } from 'electron';
import {
  listWorkspaceNodes,
  readWorkspaceNode,
  writeWorkspaceNode,
  type WorkspaceNodeRecord,
} from './store';
import { readKnowledgeTags, upsertKnowledgeTag, type KnowledgeTagDefinition } from './tags';

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

function toListItem(record: WorkspaceNodeRecord): WorkspaceNodeListItem {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    summary: summaryFromRecord(record),
    tags: tagsFromRecord(record),
    links: record.links ?? [],
    updatedAt: record.updatedAt,
    createdAt: record.createdAt,
    hasData: Object.keys(record.data ?? {}).length > 0,
    linkCount: Array.isArray(record.links) ? record.links.length : 0,
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
      return {
        ok: true,
        nodes: records.map(toListItem),
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
