import type { ArtifactSummary, CanvasNode, WorkspaceNodeListItem, WorkspaceNodeRecord, MindmapTopic } from '../../../../types';
import type { ReferenceEntry } from '../../../../shared/reference/types';
import { getReferenceId, getUrlReferenceLabel } from '../../../../shared/reference/utils';
import { getNodeDisplayLabel } from '../../../../utils/nodeLabel';
import { isReferenceableNodeType } from '../../../../utils/referenceNodes';
import { getNodeSummary, getNodeTitle } from '../../../workspace-nodes';

export type LibraryKind = 'all' | 'note' | 'link' | 'artifact' | 'image' | 'mindmap' | 'other';
export interface LibraryItem {
  id: string;
  entry: ReferenceEntry;
  title: string;
  summary: string;
  workspaceId: string;
  kind: Exclude<LibraryKind, 'all'>;
  nodeType?: CanvasNode['type'];
  previewPath?: string;
  mindmapRoot?: MindmapTopic;
  updatedAt?: number;
}

const excerpt = (text: string): string => text.slice(0, 2400)
  .replace(/<[^>]*>/g, ' ').replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^[\s#>*-]+/gm, '')
  .replace(/`{1,3}/g, '').replace(/\s+/g, ' ').trim().slice(0, 320);
const kindOf = (type: string): LibraryItem['kind'] => type === 'file' || type === 'text'
  ? 'note' : type === 'iframe' ? 'link' : type === 'image' ? 'image' : type === 'mindmap' ? 'mindmap' : 'other';

export const buildLibraryItems = (
  metadata: WorkspaceNodeListItem[], currentNodes: CanvasNode[], references: ReferenceEntry[],
  artifacts: ArtifactSummary[], activeWorkspaceId: string,
): LibraryItem[] => {
  const items = new Map<string, LibraryItem>();
  for (const node of metadata) {
    const type = node.type as CanvasNode['type'];
    if (!node.workspaceId || !isReferenceableNodeType(type)) continue;
    const entry: ReferenceEntry = { kind: 'node', workspaceId: node.workspaceId, nodeId: node.id,
      titleSnapshot: getNodeTitle(node), typeSnapshot: type, workspaceNameSnapshot: node.workspaceName };
    items.set(getReferenceId(entry), { id: getReferenceId(entry), entry, title: getNodeTitle(node),
      summary: excerpt(node.aiSummary || getNodeSummary(node)), workspaceId: node.workspaceId,
      kind: kindOf(type), nodeType: type, previewPath: node.previewPath, updatedAt: node.updatedAt });
  }
  for (const node of currentNodes) {
    if (!isReferenceableNodeType(node.type)) continue;
    const entry: ReferenceEntry = { kind: 'node', workspaceId: activeWorkspaceId, nodeId: node.id,
      titleSnapshot: getNodeDisplayLabel(node), typeSnapshot: node.type };
    const id = getReferenceId(entry), existing = items.get(id);
    const record: WorkspaceNodeRecord = { schemaVersion: 1, id: node.id, type: node.type,
      data: { ...node.data }, properties: node.properties };
    items.set(id, { ...existing, id, entry, title: getNodeDisplayLabel(node),
      summary: excerpt(getNodeSummary(record)) || existing?.summary || '',
      mindmapRoot: node.type === 'mindmap' && 'root' in node.data ? node.data.root : undefined,
      workspaceId: activeWorkspaceId, kind: kindOf(node.type), nodeType: node.type, updatedAt: node.updatedAt });
  }
  for (const artifact of artifacts) {
    const entry: ReferenceEntry = { kind: 'artifact', workspaceId: artifact.workspaceId,
      artifactId: artifact.id, titleSnapshot: artifact.title, typeSnapshot: artifact.type };
    const id = getReferenceId(entry);
    items.set(id, { id, entry, title: artifact.title, summary: artifact.type.toUpperCase(),
      workspaceId: artifact.workspaceId, kind: 'artifact', updatedAt: artifact.updatedAt });
  }
  for (const entry of references) {
    const id = getReferenceId(entry);
    if (items.has(id)) continue;
    items.set(id, { id, entry,
      title: entry.kind === 'url' ? getUrlReferenceLabel(entry) : entry.titleSnapshot || (entry.kind === 'node' ? entry.nodeId : entry.artifactId),
      summary: entry.kind === 'url' ? entry.url : '',
      workspaceId: entry.kind === 'url' ? activeWorkspaceId : entry.workspaceId,
      kind: entry.kind === 'artifact' ? 'artifact' : entry.kind === 'url' ? 'link' : kindOf(entry.typeSnapshot || ''),
      nodeType: entry.kind === 'node' ? entry.typeSnapshot : undefined });
  }
  return [...items.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
};

export const filterLibraryItems = (items: LibraryItem[], workspaceId: string | null, kind: LibraryKind, query: string) => {
  const term = query.trim().toLocaleLowerCase();
  return items.filter(item => (!workspaceId || item.workspaceId === workspaceId)
    && (kind === 'all' || item.kind === kind)
    && (!term || `${item.title} ${item.summary}`.toLocaleLowerCase().includes(term)));
};

export const LIBRARY_ROW_HEIGHT = 232;
export const libraryWindow = (count: number, scrollTop: number, height: number) => {
  const start = Math.min(Math.max(0, count - 1), Math.max(0, Math.floor(scrollTop / LIBRARY_ROW_HEIGHT) - 3));
  const end = Math.min(count, start + Math.ceil(Math.max(height, 232) / LIBRARY_ROW_HEIGHT) + 7);
  return { start, end, before: start * LIBRARY_ROW_HEIGHT, after: Math.max(0, count - end) * LIBRARY_ROW_HEIGHT };
};
