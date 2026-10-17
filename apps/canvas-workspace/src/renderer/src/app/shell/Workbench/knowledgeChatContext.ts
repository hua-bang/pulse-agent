import type {
  AgentContextCanvasRef,
  AgentContextNodeRef,
  AgentContextTagRef,
  KnowledgeNodeSelection,
  KnowledgeTagDefinition,
  WorkspaceNodeListItem,
} from '../../../types';
import type { KnowledgeChatExplicitContext } from '../../../shared/knowledgeChat';
import { isGlobalChatLauncherVisible } from '../../../shared/dock/dock-chat-availability';
import {
  getNodeTags,
  getNodeTitle,
  getNodeWorkspaceId,
  isKnowledgeNodeType,
} from '../../../modules/workspace-nodes';

export interface KnowledgeChatRouteContext {
  /** The route uses the dock's global chat instead of a workspace chat. */
  active: boolean;
  /** Knowledge routes add knowledge prompts to the global chat. */
  knowledgeMode: boolean;
  selectedNode: KnowledgeNodeSelection | null;
  explicitContext?: KnowledgeChatExplicitContext;
}

export type { KnowledgeChatExplicitContext } from '../../../shared/knowledgeChat';

interface ResolveKnowledgeChatRouteContextOptions {
  activeView: string;
  selectedNode: KnowledgeNodeSelection | null;
  detailNode: KnowledgeNodeSelection | null;
  explicitContext?: KnowledgeChatRouteContext['explicitContext'];
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
  explicitContext,
}: ResolveKnowledgeChatRouteContextOptions): KnowledgeChatRouteContext {
  if (activeView === 'nodes') {
    return {
      active: true,
      knowledgeMode: true,
      selectedNode,
      ...(explicitContext ? { explicitContext } : {}),
    };
  }
  if (activeView === 'node-detail') {
    return { active: true, knowledgeMode: true, selectedNode: detailNode };
  }
  // Graph shows every workspace's nodes, like the list, so it uses the same
  // knowledge chat. Selecting a graph node never adds chat context.
  if (activeView === 'graph') {
    return { active: true, knowledgeMode: true, selectedNode: null };
  }
  // Only the canvas belongs to one workspace. Every other route with the
  // floating launcher (plugins, skills, scheduled list, apps) opens the
  // global chat, so it never borrows the last canvas's conversation.
  if (isGlobalChatLauncherVisible(activeView)) {
    return { active: true, knowledgeMode: false, selectedNode: null };
  }
  return { active: false, knowledgeMode: false, selectedNode: null };
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
