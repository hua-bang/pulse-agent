import type { KnowledgeTagDefinition, WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../types';

export const NODE_TYPE_LABELS: Record<string, string> = {
  file: 'File',
  text: 'Text',
  iframe: 'Web',
  image: 'Image',
  mindmap: 'Mindmap',
};

export const NODE_TYPE_FILTERS = [
  'all',
  'text',
  'file',
  'iframe',
  'image',
  'mindmap',
  'untagged',
] as const;

export type NodeTypeFilter = typeof NODE_TYPE_FILTERS[number];

export function getNodeTitle(node: WorkspaceNodeListItem | WorkspaceNodeRecord | null | undefined): string {
  if (!node) return 'Untitled';
  return node.title?.trim() || node.id || 'Untitled';
}

export function getNodeTypeLabel(type: string | undefined): string {
  if (!type) return 'Node';
  return NODE_TYPE_LABELS[type] ?? type;
}

export function isKnowledgeNodeType(type: string | undefined): boolean {
  return type === 'text'
    || type === 'file'
    || type === 'iframe'
    || type === 'image'
    || type === 'mindmap';
}

export function getNodeTags(node: WorkspaceNodeListItem | WorkspaceNodeRecord | null | undefined): string[] {
  if (!node) return [];
  if ('tags' in node && Array.isArray(node.tags)) return node.tags;
  if (!('properties' in node)) return [];
  const raw = node.properties?.tags;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

export function getNodeSummary(node: WorkspaceNodeListItem | WorkspaceNodeRecord | null | undefined): string {
  if (!node) return '';
  if ('summary' in node && typeof node.summary === 'string' && node.summary.trim()) return node.summary;
  if (!('data' in node)) return '';

  const summary = node.properties?.summary;
  if (typeof summary === 'string' && summary.trim()) return summary;
  const data = node.data ?? {};
  for (const key of ['content', 'scrollback', 'url', 'filePath', 'html']) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

export function getNodeWorkspaceId(node: WorkspaceNodeListItem | WorkspaceNodeRecord | null | undefined): string {
  if (!node) return '';
  if ('workspaceId' in node && typeof node.workspaceId === 'string') return node.workspaceId;
  return '';
}

export function tagName(tagId: string, tags: KnowledgeTagDefinition[]): string {
  return tags.find((tag) => tag.id === tagId)?.name ?? tagId;
}

export function formatTime(value: number | undefined): string {
  if (!value) return 'No timestamp';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No timestamp';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export function truncateText(value: string, max = 220): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}...`;
}

export function matchesSearch(node: WorkspaceNodeListItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    node.id,
    node.workspaceName ?? '',
    node.title ?? '',
    node.summary ?? '',
    node.type,
    ...node.tags,
  ].some((value) => value.toLowerCase().includes(q));
}
