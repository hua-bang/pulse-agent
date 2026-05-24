import type { CanvasNode, ReferenceNodeData } from '../../types';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import { MIN_REFERENCE_DRAWER_WIDTH, NODE_TYPE_LABELS } from './constants';
import type { ReferenceEntry, ReferenceGroupKey, UrlReferenceEntry } from './types';

export const isUrlReference = (entry: ReferenceEntry): entry is UrlReferenceEntry => entry.kind === 'url';

export const getReferenceId = (entry: ReferenceEntry) => isUrlReference(entry)
  ? entry.id
  : `${entry.workspaceId}:${entry.nodeId}`;

export const getNodeReferenceId = (workspaceId: string, nodeId: string) => `${workspaceId}:${nodeId}`;

export const getReferenceGroupLabel = (type: ReferenceGroupKey) => {
  if (type === 'url') return 'URL';
  if (type === 'missing') return 'Missing nodes';
  return NODE_TYPE_LABELS[type];
};

export const getReferenceGroupIcon = (type: ReferenceGroupKey) => {
  switch (type) {
    case 'file': return 'N';
    case 'text': return 'T';
    case 'image': return 'I';
    case 'iframe': return 'W';
    case 'url': return '@';
    case 'agent': return 'A';
    case 'terminal': return '$';
    case 'mindmap': return 'M';
    case 'reference': return 'R';
    case 'shape': return 'S';
    case 'frame': return 'F';
    case 'group': return 'G';
    case 'missing': return '?';
  }
};

export const getUrlHostname = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

export const getUrlReferenceLabel = (entry: UrlReferenceEntry) => (
  entry.title?.trim() || getUrlHostname(entry.url) || entry.url
);

export const createUrlPreviewNode = (entry: UrlReferenceEntry, drawerWidth: number): CanvasNode => ({
  id: entry.id,
  type: 'iframe',
  title: getUrlReferenceLabel(entry),
  x: 0,
  y: 0,
  width: Math.max(MIN_REFERENCE_DRAWER_WIDTH - 32, drawerWidth - 32),
  height: 420,
  data: {
    mode: 'url',
    url: entry.url,
    pageTitle: entry.title,
  },
});

export const normalizeReferenceUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.href;
  } catch {
    return undefined;
  }
};

export const createReferenceNodeDataSnapshot = (
  node: CanvasNode,
  workspaceName?: string,
): ReferenceNodeData => ({
  titleSnapshot: getNodeDisplayLabel(node),
  typeSnapshot: node.type === 'reference' ? undefined : node.type,
  workspaceNameSnapshot: workspaceName,
});
