import type { KnowledgeTagDefinition, WorkspaceNodeListItem } from '../../../types';
import {
  getNodeTags,
  getNodeTitle,
  getNodeWorkspaceId,
  tagName,
} from '../../../views/WorkspaceNodes/utils';

export type WorkspaceGraphNodeKind = 'node' | 'tag' | 'missing' | 'workspace';
export type WorkspaceGraphLinkKind = 'tag' | 'link' | 'workspace';

export interface WorkspaceGraphNode {
  id: string;
  kind: WorkspaceGraphNodeKind;
  label: string;
  workspaceId?: string;
  nodeId?: string;
  source?: WorkspaceNodeListItem;
  x?: number;
  y?: number;
}

export interface WorkspaceGraphLink {
  source: string | WorkspaceGraphNode;
  target: string | WorkspaceGraphNode;
  kind: WorkspaceGraphLinkKind;
  relation?: string;
}

export interface WorkspaceGraphData {
  nodes: WorkspaceGraphNode[];
  links: WorkspaceGraphLink[];
}

export type WorkspaceGraphSearchResult =
  | { kind: 'node'; node: WorkspaceNodeListItem }
  | { kind: 'tag'; graphId: string; label: string };

export const workspaceGraphId = (workspaceId: string): string => `ws:${workspaceId}`;
export const nodeGraphId = (workspaceId: string, nodeId: string): string => `${workspaceId}:${nodeId}`;

export const getGraphId = (
  value: string | number | { id?: string | number } | null | undefined,
): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return String(value.id ?? '');
  return String(value);
};

interface BuildWorkspaceGraphOptions {
  nodes: WorkspaceNodeListItem[];
  tags: KnowledgeTagDefinition[];
  workspaces: Array<{ id: string; name: string }>;
  options: { showTags: boolean; showLinks: boolean; showWorkspaceHubs: boolean };
  untitled: string;
}

export const buildWorkspaceGraph = ({
  nodes,
  tags,
  workspaces,
  options,
  untitled,
}: BuildWorkspaceGraphOptions): WorkspaceGraphData => {
  const graphNodes = new Map<string, WorkspaceGraphNode>();
  const graphLinks: WorkspaceGraphLink[] = [];
  const visibleNodeIds = new Set(nodes.map((node) => nodeGraphId(getNodeWorkspaceId(node), node.id)));
  const workspaceById = new Map(workspaces.map((workspace) => [workspace.id, workspace] as const));
  const workspaceUsage = new Map<string, number>();

  for (const node of nodes) {
    const workspaceId = getNodeWorkspaceId(node);
    const id = nodeGraphId(workspaceId, node.id);
    graphNodes.set(id, {
      id,
      kind: 'node',
      label: getNodeTitle(node, untitled),
      workspaceId,
      nodeId: node.id,
      source: node,
    });
    workspaceUsage.set(workspaceId, (workspaceUsage.get(workspaceId) ?? 0) + 1);
  }

  if (options.showWorkspaceHubs) {
    for (const [workspaceId, count] of workspaceUsage) {
      if (count === 0) continue;
      graphNodes.set(workspaceGraphId(workspaceId), {
        id: workspaceGraphId(workspaceId),
        kind: 'workspace',
        label: workspaceById.get(workspaceId)?.name ?? workspaceId,
        workspaceId,
      });
    }
    for (const node of nodes) {
      const workspaceId = getNodeWorkspaceId(node);
      const hubId = workspaceGraphId(workspaceId);
      if (graphNodes.has(hubId)) {
        graphLinks.push({ source: hubId, target: nodeGraphId(workspaceId, node.id), kind: 'workspace' });
      }
    }
  }

  if (options.showTags) {
    for (const node of nodes) {
      const source = nodeGraphId(getNodeWorkspaceId(node), node.id);
      for (const tag of getNodeTags(node)) {
        const tagId = `tag:${tag}`;
        if (!graphNodes.has(tagId)) {
          graphNodes.set(tagId, { id: tagId, kind: 'tag', label: tagName(tag, tags) });
        }
        graphLinks.push({ source, target: tagId, kind: 'tag' });
      }
    }
  }

  if (options.showLinks) {
    for (const node of nodes) {
      const workspaceId = getNodeWorkspaceId(node);
      const source = nodeGraphId(workspaceId, node.id);
      for (const link of node.links ?? []) {
        const targetWorkspaceId = link.target.workspaceId ?? workspaceId;
        const target = nodeGraphId(targetWorkspaceId, link.target.nodeId);
        if (!visibleNodeIds.has(target) && !graphNodes.has(target)) {
          graphNodes.set(target, { id: target, kind: 'missing', label: link.target.nodeId });
        }
        graphLinks.push({ source, target, kind: 'link', relation: link.relation });
      }
    }
  }
  return { nodes: [...graphNodes.values()], links: graphLinks };
};

export const searchWorkspaceGraph = ({
  nodes,
  tags,
  query,
  showTags,
}: {
  nodes: WorkspaceNodeListItem[];
  tags: KnowledgeTagDefinition[];
  query: string;
  showTags: boolean;
}): WorkspaceGraphSearchResult[] => {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const tagResults: Array<Extract<WorkspaceGraphSearchResult, { kind: 'tag' }>> = [];
  if (showTags) {
    const seen = new Set<string>();
    for (const node of nodes) {
      for (const token of node.tags) {
        if (seen.has(token)) continue;
        seen.add(token);
        const label = tagName(token, tags);
        if (label.toLowerCase().includes(normalized) || token.toLowerCase().includes(normalized)) {
          tagResults.push({ kind: 'tag', graphId: `tag:${token}`, label });
        }
      }
    }
    tagResults.sort((left, right) => left.label.localeCompare(right.label));
  }
  const nodeResults: WorkspaceGraphSearchResult[] = nodes
    .filter((node) => [
      node.id,
      node.workspaceName ?? '',
      getNodeTitle(node, ''),
      node.summary ?? '',
      ...node.tags.map((tagId) => tagName(tagId, tags)),
    ].some((value) => value.toLowerCase().includes(normalized)))
    .map((node) => ({ kind: 'node', node }));
  return [...tagResults.slice(0, 6), ...nodeResults].slice(0, 12);
};

export const getWorkspaceGraphHighlight = (
  graph: WorkspaceGraphData,
  anchorId: string | null | undefined,
): { nodeIds: Set<string>; linkIds: Set<string> } => {
  const nodeIds = new Set<string>();
  const linkIds = new Set<string>();
  if (!anchorId) return { nodeIds, linkIds };
  nodeIds.add(anchorId);
  for (const link of graph.links) {
    const source = getGraphId(link.source);
    const target = getGraphId(link.target);
    const neighbor = source === anchorId ? target : target === anchorId ? source : null;
    if (!neighbor) continue;
    nodeIds.add(neighbor);
    linkIds.add(`${anchorId}->${neighbor}`);
    linkIds.add(`${neighbor}->${anchorId}`);
  }
  return { nodeIds, linkIds };
};
