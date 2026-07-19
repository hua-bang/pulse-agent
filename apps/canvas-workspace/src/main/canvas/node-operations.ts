import { promises as fs } from 'fs';

import type { CanvasNode } from './storage';
import { loadCanvas, saveCanvas } from './service';
import { broadcastCanvasUpdate } from './broadcast';
import {
  listWorkspaceNodes,
  type WorkspaceNodeRecord,
} from './nodes/store';
import { readKnowledgeTags } from './nodes/tags';

export interface SearchCanvasNodesInput {
  query?: string;
  type?: string | string[];
  tag?: string | string[];
  limit?: number;
}

export interface CanvasNodeSearchMatch {
  id: string;
  type: string;
  title: string;
  snippet: string;
  x: number;
  y: number;
  tags?: string[];
}

export interface SearchCanvasNodesResult {
  workspaceId: string;
  total: number;
  truncated: boolean;
  matches: CanvasNodeSearchMatch[];
}

export interface UpdateCanvasNodeInput {
  nodeId: string;
  title?: string;
  content?: string;
  data?: Record<string, unknown>;
}

export async function searchCanvasNodes(
  workspaceId: string,
  input: SearchCanvasNodesInput,
): Promise<SearchCanvasNodesResult | null> {
  const canvas = await loadCanvas(workspaceId);
  if (!canvas) return null;

  const query = input.query?.trim().toLowerCase() ?? '';
  const typeFilter = input.type
    ? new Set(Array.isArray(input.type) ? input.type : [input.type])
    : null;
  const tagFilter = input.tag
    ? (Array.isArray(input.tag) ? input.tag : [input.tag])
      .map((tag) => tag.trim())
      .filter(Boolean)
    : null;
  const limit = input.limit ?? 30;

  const workspaceNodeById = new Map<string, WorkspaceNodeRecord>();
  let tagAcceptSets: Set<string>[] | null = null;
  if (tagFilter?.length) {
    for (const record of await listWorkspaceNodes(workspaceId)) {
      workspaceNodeById.set(record.id, record);
    }
    const idsByName = new Map<string, string[]>();
    for (const tag of await readKnowledgeTags()) {
      const key = tag.name.trim().toLowerCase();
      idsByName.set(key, [...(idsByName.get(key) ?? []), tag.id]);
    }
    tagAcceptSets = tagFilter.map((token) => new Set([
      token,
      ...(idsByName.get(token.toLowerCase()) ?? []),
    ]));
  }

  const matches: CanvasNodeSearchMatch[] = [];
  for (const node of canvas.nodes ?? []) {
    if (!node.id) continue;
    if (typeFilter && !typeFilter.has(node.type)) continue;
    const record = workspaceNodeById.get(node.id);
    const storedTags = Array.isArray(record?.properties?.tags)
      ? record.properties.tags.filter((tag): tag is string => typeof tag === 'string')
      : [];
    if (tagAcceptSets && !tagAcceptSets.every(
      (accepted) => storedTags.some((tag) => accepted.has(tag)),
    )) {
      continue;
    }
    if (query && !nodeHaystacks(node).join('\n').toLowerCase().includes(query)) continue;

    matches.push({
      id: node.id,
      type: node.type,
      title: node.title ?? '',
      snippet: nodeSnippet(node),
      x: node.x ?? 0,
      y: node.y ?? 0,
      ...(storedTags.length ? { tags: storedTags } : {}),
    });
    if (matches.length >= limit) break;
  }

  return {
    workspaceId,
    total: matches.length,
    truncated: matches.length >= limit,
    matches,
  };
}

export async function updateCanvasNode(
  workspaceId: string,
  input: UpdateCanvasNodeInput,
): Promise<'updated' | 'workspace_not_found' | 'node_not_found' | 'deleted_concurrently'> {
  const initial = await loadCanvas(workspaceId);
  if (!initial) return 'workspace_not_found';
  const initialNode = initial.nodes?.find((node) => node.id === input.nodeId);
  if (!initialNode) return 'node_not_found';

  const initialData = initialNode.data as Record<string, unknown>;
  if (initialNode.type === 'file' && input.content != null && initialData.filePath) {
    await fs.writeFile(String(initialData.filePath), input.content, 'utf-8');
  }

  const fresh = (await loadCanvas(workspaceId)) ?? initial;
  const nodes = fresh.nodes ?? [];
  const index = nodes.findIndex((node) => node.id === input.nodeId);
  if (index === -1) return 'deleted_concurrently';
  const node = nodes[index];
  const data = node.data as Record<string, unknown>;

  if (input.title) node.title = input.title;
  if ((node.type === 'file' || node.type === 'text') && input.content != null) {
    data.content = input.content;
  }
  if (input.data) Object.assign(data, input.data);
  node.updatedAt = Date.now();

  await saveCanvas(workspaceId, fresh);
  broadcastCanvasUpdate(workspaceId, [input.nodeId], 'update', 'canvas-agent');
  return 'updated';
}

function nodeHaystacks(node: CanvasNode): string[] {
  const fields = [node.title ?? '', node.type ?? ''];
  const data = node.data as Record<string, unknown>;
  for (const key of ['content', 'label', 'url', 'filePath', 'cwd', 'prompt', 'html']) {
    if (typeof data[key] === 'string') fields.push(data[key]);
  }
  return fields;
}

function nodeSnippet(node: CanvasNode): string {
  const data = node.data as Record<string, unknown>;
  const first = ['content', 'label', 'url', 'filePath']
    .map((key) => data[key])
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? '';
  const normalized = first.replace(/\s+/g, ' ').trim();
  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
}
