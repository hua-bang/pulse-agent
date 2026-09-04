import type { CanvasNode, MentionItem, WorkspaceOption } from '../../../types';
import { getNodeDisplayLabel } from '../../../utils/nodeLabel';

interface StaticMentionItemsOptions {
  allWorkspaces?: WorkspaceOption[];
  workspaceId?: string;
  nodes?: CanvasNode[];
  knowledgeNodes?: Array<{
    id: string;
    title: string;
    type: CanvasNode['type'];
    workspaceId?: string;
  }>;
  knowledgeTags?: Array<{
    id: string;
    name: string;
    workspaceIds?: string[];
  }>;
}

/** Synchronous scope-owned candidates; async roles/files/sessions stay in the hook. */
export const buildStaticMentionItems = ({
  allWorkspaces,
  workspaceId,
  nodes,
  knowledgeNodes,
  knowledgeTags,
}: StaticMentionItemsOptions): MentionItem[] => {
  const items: MentionItem[] = [];
  for (const workspace of allWorkspaces ?? []) {
    if (workspace.id !== workspaceId) {
      items.push({ type: 'workspace', label: workspace.name, workspaceId: workspace.id });
    }
  }
  if (workspaceId) {
    for (const node of nodes ?? []) {
      items.push({
        type: 'node',
        nodeId: node.id,
        label: getNodeDisplayLabel(node),
        nodeType: node.type,
        path: (node.data as { filePath?: string })?.filePath,
      });
    }
  }
  for (const node of knowledgeNodes ?? []) {
    items.push({
      type: 'node',
      nodeId: node.id,
      label: node.title,
      nodeType: node.type,
      workspaceId: node.workspaceId,
      description: allWorkspaces?.find(workspace => workspace.id === node.workspaceId)?.name,
    });
  }
  for (const tag of knowledgeTags ?? []) {
    items.push({
      type: 'tag',
      label: tag.name,
      workspaceIds: tag.workspaceIds,
    });
  }
  return items;
};
