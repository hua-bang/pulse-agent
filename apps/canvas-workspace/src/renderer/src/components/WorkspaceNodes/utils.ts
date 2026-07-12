import type { CanvasNode, KnowledgeTagDefinition, WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../types';
import type { I18nKey } from '../../i18n';

export const NODE_TYPE_LABEL_KEYS: Record<string, I18nKey> = {
  file: 'workspaceNodes.type.file',
  text: 'workspaceNodes.type.text',
  iframe: 'workspaceNodes.type.iframe',
  image: 'workspaceNodes.type.image',
  mindmap: 'workspaceNodes.type.mindmap',
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

export function getNodeTitle(
  node: WorkspaceNodeListItem | WorkspaceNodeRecord | null | undefined,
  fallback = 'Untitled',
): string {
  if (!node) return fallback;
  // List items carry a derived `displayTitle` (e.g. a text-content preview) that
  // reads better than the bare type word ("Text") or empty title.
  if ('displayTitle' in node) {
    const display = node.displayTitle?.trim();
    if (display) return display;
  }
  return node.title?.trim() || node.id || fallback;
}

export function getNodeTypeLabel(
  type: string | undefined,
  t?: (key: I18nKey) => string,
  fallback = 'Node',
): string {
  if (!type) return fallback;
  const labelKey = NODE_TYPE_LABEL_KEYS[type];
  if (labelKey && t) return t(labelKey);
  return type;
}

export type KnowledgeNodeType = Extract<CanvasNode['type'], 'text' | 'file' | 'iframe' | 'image' | 'mindmap'>;

export function isKnowledgeNodeType(type: string | undefined): type is KnowledgeNodeType {
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

export function getNodeAiSummary(node: WorkspaceNodeListItem | WorkspaceNodeRecord | null | undefined): string {
  if (!node) return '';
  if ('aiSummary' in node && typeof node.aiSummary === 'string' && node.aiSummary.trim()) return node.aiSummary;
  if (!('properties' in node)) return '';
  const summary = node.properties?.aiSummary;
  return typeof summary === 'string' ? summary.trim() : '';
}

export function getNodeWorkspaceId(node: WorkspaceNodeListItem | WorkspaceNodeRecord | null | undefined): string {
  if (!node) return '';
  if ('workspaceId' in node && typeof node.workspaceId === 'string') return node.workspaceId;
  return '';
}

export function tagName(tagId: string, tags: KnowledgeTagDefinition[]): string {
  return tags.find((tag) => tag.id === tagId)?.name ?? tagId;
}

export function formatTime(value: number | undefined, noTimestamp = 'No timestamp', locale?: string): string {
  if (!value) return noTimestamp;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return noTimestamp;
  return date.toLocaleDateString(locale, {
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
