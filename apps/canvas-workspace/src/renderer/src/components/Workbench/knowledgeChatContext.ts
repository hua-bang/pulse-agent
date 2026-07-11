import type {
  AgentContextNodeRef,
  KnowledgeNodeSelection,
  KnowledgeTagDefinition,
  WorkspaceNodeListItem,
} from '../../types';
import {
  getNodeTags,
  getNodeTitle,
  getNodeWorkspaceId,
  isKnowledgeNodeType,
} from '../WorkspaceNodes/utils';

export interface KnowledgeChatRouteContext {
  active: boolean;
  selectedNode: KnowledgeNodeSelection | null;
}

interface ResolveKnowledgeChatRouteContextOptions {
  activeView: string;
  selectedNode: KnowledgeNodeSelection | null;
  detailNode: KnowledgeNodeSelection | null;
}

type KnowledgeNodeMentionCandidate = AgentContextNodeRef;

type KnowledgeChatNode = WorkspaceNodeListItem & {
  type: AgentContextNodeRef['type'];
};

function isKnowledgeChatNode(node: WorkspaceNodeListItem): node is KnowledgeChatNode {
  return isKnowledgeNodeType(node.type);
}

interface KnowledgeTagMentionCandidate {
  id: string;
  name: string;
  workspaceIds?: string[];
}

export interface KnowledgeChatContext {
  knowledgeNodes: KnowledgeNodeMentionCandidate[];
  knowledgeTags: KnowledgeTagMentionCandidate[];
  contextNodes: AgentContextNodeRef[];
}

export function resolveKnowledgeChatRouteContext({
  activeView,
  selectedNode,
  detailNode,
}: ResolveKnowledgeChatRouteContextOptions): KnowledgeChatRouteContext {
  if (activeView === 'nodes') {
    return { active: true, selectedNode };
  }
  if (activeView === 'node-detail') {
    return { active: true, selectedNode: detailNode };
  }
  return { active: false, selectedNode: null };
}

export function buildKnowledgeChatContext(
  nodes: WorkspaceNodeListItem[],
  tags: KnowledgeTagDefinition[],
  selectedNode: KnowledgeNodeSelection | null,
): KnowledgeChatContext {
  const knowledgeNodes = nodes
    .filter(isKnowledgeChatNode)
    .map<KnowledgeNodeMentionCandidate>((node) => ({
      id: node.id,
      title: getNodeTitle(node),
      type: node.type,
      workspaceId: getNodeWorkspaceId(node) || undefined,
    }));

  const workspacesByTag = new Map<string, Set<string>>();
  for (const node of nodes) {
    const workspaceId = getNodeWorkspaceId(node);
    if (!workspaceId) continue;
    for (const tagId of getNodeTags(node)) {
      const workspaceIds = workspacesByTag.get(tagId) ?? new Set<string>();
      workspaceIds.add(workspaceId);
      workspacesByTag.set(tagId, workspaceIds);
    }
  }

  const knowledgeTags = tags.map<KnowledgeTagMentionCandidate>((tag) => ({
    id: tag.id,
    name: tag.name,
    workspaceIds: Array.from(workspacesByTag.get(tag.id) ?? []),
  }));

  const selected = selectedNode
    ? knowledgeNodes.find((node) => (
        node.workspaceId === selectedNode.workspaceId && node.id === selectedNode.nodeId
      ))
    : undefined;

  return {
    knowledgeNodes,
    knowledgeTags,
    contextNodes: selected ? [selected] : [],
  };
}
