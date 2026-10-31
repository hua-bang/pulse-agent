import { writeWorkspaceText } from '../files/workspace-files';

import type { CanvasNode } from './storage';
import { loadCanvas, saveCanvas } from './service';
import { broadcastCanvasUpdate } from './broadcast';
import {
  listWorkspaceNodes,
  type WorkspaceNodeRecord,
} from './nodes/store';
import { readKnowledgeTags } from './nodes/tags';
import type { snippetAround as SnippetAround } from './nodes/search-ranking';

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

  // Loaded on first use to keep it out of the main entry chunk.
  const { queryTerms, scoreNode, snippetAround } = await import('./nodes/search-ranking');
  const query = input.query?.trim() ?? '';
  const terms = queryTerms(query);
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

  const ranked: Array<{ match: CanvasNodeSearchMatch; matchedTerms: number; score: number; order: number }> = [];
  for (const [order, node] of (canvas.nodes ?? []).entries()) {
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
    const score = terms.length > 0
      ? scoreNode({ title: node.title ?? '', body: nodeSearchBody(node) }, query, terms)
      : null;
    if (terms.length > 0 && !score) continue;

    ranked.push({
      match: {
        id: node.id,
        type: node.type,
        title: node.title ?? '',
        snippet: nodeSnippet(node, score?.bodyMatchIndex ?? -1, snippetAround),
        x: node.x ?? 0,
        y: node.y ?? 0,
        ...(storedTags.length ? { tags: storedTags } : {}),
      },
      matchedTerms: score?.matchedTerms ?? 0,
      score: score?.score ?? 0,
      order,
    });
  }

  // Without a query, canvas order; with one, most matched terms first.
  ranked.sort((a, b) => (b.matchedTerms - a.matchedTerms) || (b.score - a.score) || (a.order - b.order));
  return {
    workspaceId,
    total: ranked.length,
    truncated: ranked.length > limit,
    matches: ranked.slice(0, limit).map((entry) => entry.match),
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
    await writeWorkspaceText(String(initialData.filePath), input.content);
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

/** Searchable text after the title; the type goes last so it can match
 * without leading every snippet. */
function nodeSearchBody(node: CanvasNode): string {
  const [, type, ...fields] = nodeHaystacks(node);
  return [...fields, type].join('\n');
}

function nodeHaystacks(node: CanvasNode): string[] {
  const fields = [node.title ?? '', node.type ?? ''];
  const data = node.data as Record<string, unknown>;
  for (const key of ['content', 'label', 'url', 'filePath', 'cwd', 'prompt', 'html']) {
    if (typeof data[key] === 'string') fields.push(data[key]);
  }
  return fields;
}

function nodeSnippet(node: CanvasNode, bodyMatchIndex: number, snippetAround: typeof SnippetAround): string {
  const data = node.data as Record<string, unknown>;
  // A match inside the body shows the text around it; otherwise the first field.
  if (bodyMatchIndex >= 0) {
    return snippetAround(nodeSearchBody(node), bodyMatchIndex);
  }
  const first = ['content', 'label', 'url', 'filePath']
    .map((key) => data[key])
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? '';
  return snippetAround(first, 0);
}
