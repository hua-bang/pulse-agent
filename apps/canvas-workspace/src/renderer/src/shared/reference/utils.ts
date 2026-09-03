import type { CanvasNode, ReferenceNodeData } from '../../types';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import { MIN_REFERENCE_DRAWER_WIDTH } from './constants';
import type { ArtifactReferenceEntry, ReferenceEntry, ReferenceGroupKey, UrlReferenceEntry } from './types';

export const isUrlReference = (entry: ReferenceEntry): entry is UrlReferenceEntry => entry.kind === 'url';

export const isArtifactReference = (entry: ReferenceEntry): entry is ArtifactReferenceEntry =>
  entry.kind === 'artifact';

export const getReferenceId = (entry: ReferenceEntry) => {
  if (isUrlReference(entry)) return entry.id;
  if (isArtifactReference(entry)) return `artifact:${entry.workspaceId}:${entry.artifactId}`;
  return `${entry.workspaceId}:${entry.nodeId}`;
};

export const getNodeReferenceId = (workspaceId: string, nodeId: string) => `${workspaceId}:${nodeId}`;

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

/**
 * Preview shell for an artifact reference: a synthetic iframe node in
 * mode:'artifact', rendered by IframeNodeBody with the ARTIFACT's storage
 * scope as workspaceId — which is why cross-scope entries preview fine.
 */
export const createArtifactPreviewNode = (entry: ArtifactReferenceEntry, drawerWidth: number): CanvasNode => ({
  id: getReferenceId(entry),
  type: 'iframe',
  title: entry.titleSnapshot ?? 'Artifact',
  x: 0,
  y: 0,
  width: Math.max(MIN_REFERENCE_DRAWER_WIDTH - 32, drawerWidth - 32),
  height: 420,
  data: {
    mode: 'artifact',
    url: 'about:blank',
    artifactId: entry.artifactId,
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
