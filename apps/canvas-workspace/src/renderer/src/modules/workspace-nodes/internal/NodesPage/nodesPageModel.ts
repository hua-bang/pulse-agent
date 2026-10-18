import type {
  AgentContextCanvasRef,
  AgentContextNodeRef,
  AgentContextTagRef,
  KnowledgeTagDefinition,
  WorkspaceNodeListItem,
} from '../../../../types';
import type { NodesAiContext } from '../knowledgeAiContext';
import {
  type NodeTypeFilter,
  getNodeTags,
  getNodeTitle,
  getNodeWorkspaceId,
  isKnowledgeNodeType,
  matchesSearch,
  tagName,
  UNTAGGED_TAG_FILTER,
} from '../utils';

export interface NodesPageFilters {
  activeWorkspaceIds: Set<string>;
  query: string;
  typeFilter: NodeTypeFilter;
  tagFilter: string | null;
}

export const nodeKey = (node: WorkspaceNodeListItem): string => (
  `${getNodeWorkspaceId(node)}:${node.id}`
);

export const toAgentContextNodeRef = (
  node: WorkspaceNodeListItem,
  untitled: string,
): AgentContextNodeRef | null => {
  if (!isKnowledgeNodeType(node.type)) return null;
  const workspaceId = getNodeWorkspaceId(node);
  if (!workspaceId) return null;
  return {
    id: node.id,
    title: getNodeTitle(node, untitled),
    type: node.type,
    workspaceId,
  };
};

const matchesType = (node: WorkspaceNodeListItem, typeFilter: NodeTypeFilter): boolean => (
  typeFilter === 'all' || node.type === typeFilter
);

const matchesTag = (node: WorkspaceNodeListItem, tagFilter: string | null): boolean => {
  if (tagFilter === null) return true;
  const tags = getNodeTags(node);
  return tagFilter === UNTAGGED_TAG_FILTER ? tags.length === 0 : tags.includes(tagFilter);
};

export const filterWorkspaceNodes = (
  nodes: WorkspaceNodeListItem[],
  filters: NodesPageFilters,
): WorkspaceNodeListItem[] => nodes.filter((node) => (
  filters.activeWorkspaceIds.has(getNodeWorkspaceId(node))
  && matchesSearch(node, filters.query)
  && matchesType(node, filters.typeFilter)
  && matchesTag(node, filters.tagFilter)
));

export interface NodeFacetCounts {
  workspaces: Map<string, number>;
  workspacesAll: number;
  types: Map<string, number>;
  typesAll: number;
  /** Per-tag counts, keyed by tag id or UNTAGGED_TAG_FILTER. */
  tags: Map<string, number>;
  tagsAll: number;
}

const increment = <K>(counts: Map<K, number>, key: K) => {
  counts.set(key, (counts.get(key) ?? 0) + 1);
};

/**
 * Counts what each filter option would show if picked now: every count
 * applies the search and the other two dimensions, but not its own.
 */
export const countNodeFacets = (
  nodes: WorkspaceNodeListItem[],
  filters: NodesPageFilters,
): NodeFacetCounts => {
  const counts: NodeFacetCounts = {
    workspaces: new Map(),
    workspacesAll: 0,
    types: new Map(),
    typesAll: 0,
    tags: new Map(),
    tagsAll: 0,
  };
  for (const node of nodes) {
    if (!matchesSearch(node, filters.query)) continue;
    const inWorkspace = filters.activeWorkspaceIds.has(getNodeWorkspaceId(node));
    const inType = matchesType(node, filters.typeFilter);
    const inTag = matchesTag(node, filters.tagFilter);
    if (inType && inTag) {
      increment(counts.workspaces, getNodeWorkspaceId(node));
      counts.workspacesAll += 1;
    }
    if (inWorkspace && inTag) {
      increment(counts.types, node.type);
      counts.typesAll += 1;
    }
    if (inWorkspace && inType) {
      const tags = getNodeTags(node);
      counts.tagsAll += 1;
      if (tags.length === 0) increment(counts.tags, UNTAGGED_TAG_FILTER);
      for (const tag of tags) increment(counts.tags, tag);
    }
  }
  return counts;
};

interface BuildNodesAiScopeInput extends NodesPageFilters {
  filteredNodes: WorkspaceNodeListItem[];
  workspaces: Array<{ id: string; name: string }>;
  selectedWorkspaceIds: Set<string> | null;
  tagDefinitions: KnowledgeTagDefinition[];
  untitled: string;
}

export const buildNodesAiScope = ({
  filteredNodes,
  workspaces,
  activeWorkspaceIds,
  selectedWorkspaceIds,
  query,
  typeFilter,
  tagFilter,
  tagDefinitions,
  untitled,
}: BuildNodesAiScopeInput): NodesAiContext | null => {
  const hasFilterIntent = query.trim().length > 0
    || selectedWorkspaceIds !== null
    || typeFilter !== 'all'
    || tagFilter !== null;
  if (!hasFilterIntent || filteredNodes.length === 0) return null;

  const nodeRefs = filteredNodes
    .map((node) => toAgentContextNodeRef(node, untitled))
    .filter((node): node is AgentContextNodeRef => node !== null);
  if (nodeRefs.length > 0 && nodeRefs.length <= 12) return { nodes: nodeRefs };
  if (
    query.trim().length > 0
    || typeFilter !== 'all'
    || tagFilter === UNTAGGED_TAG_FILTER
  ) return null;

  const canvases = selectedWorkspaceIds === null
    ? []
    : workspaces
      .filter((workspace) => activeWorkspaceIds.has(workspace.id))
      .map((workspace): AgentContextCanvasRef => ({
        id: workspace.id,
        name: workspace.name,
      }));
  const tags = tagFilter
    ? [{
        name: tagName(tagFilter, tagDefinitions),
        workspaceIds: Array.from(activeWorkspaceIds),
      } satisfies AgentContextTagRef]
    : [];

  return canvases.length > 0 || tags.length > 0
    ? {
        nodes: [],
        ...(tags.length > 0 ? { tags } : {}),
        ...(canvases.length > 0 ? { canvases } : {}),
      }
    : null;
};

export const reconcileNodeSelection = (
  current: Set<string>,
  nodes: WorkspaceNodeListItem[],
): Set<string> => {
  const available = new Set(nodes.map(nodeKey));
  const next = new Set(Array.from(current).filter((key) => available.has(key)));
  return next.size === current.size ? current : next;
};
