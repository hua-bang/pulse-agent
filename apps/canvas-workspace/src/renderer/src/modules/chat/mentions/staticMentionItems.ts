import type { CanvasNode, MentionItem, WorkspaceOption } from '../../../types';
import { getNodeDisplayLabel } from '../../../utils/nodeLabel';

interface StaticMentionItemsOptions {
  allWorkspaces?: WorkspaceOption[];
  workspaceId?: string;
  nodes?: CanvasNode[];
  knowledgeTags?: Array<{
    id: string;
    name: string;
    workspaceIds?: string[];
  }>;
}

/** Synchronous scope-owned candidates; async roles/files/sessions and other canvases' nodes stay in the hook. */
export const buildStaticMentionItems = ({
  allWorkspaces,
  workspaceId,
  nodes,
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
  for (const tag of knowledgeTags ?? []) {
    items.push({
      type: 'tag',
      label: tag.name,
      workspaceIds: tag.workspaceIds,
    });
  }
  return items;
};
