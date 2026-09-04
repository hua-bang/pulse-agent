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

export const filterWorkspaceNodes = (
  nodes: WorkspaceNodeListItem[],
  filters: NodesPageFilters,
): WorkspaceNodeListItem[] => nodes.filter((node) => {
  if (!filters.activeWorkspaceIds.has(getNodeWorkspaceId(node))) return false;
  if (!matchesSearch(node, filters.query)) return false;
  if (filters.typeFilter === 'untagged' && getNodeTags(node).length > 0) return false;
  if (
    filters.typeFilter !== 'all'
    && filters.typeFilter !== 'untagged'
    && node.type !== filters.typeFilter
  ) return false;
  if (filters.tagFilter && !getNodeTags(node).includes(filters.tagFilter)) return false;
  return true;
});

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
  if (query.trim().length > 0 || typeFilter !== 'all') return null;

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
