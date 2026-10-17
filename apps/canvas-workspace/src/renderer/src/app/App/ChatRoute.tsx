import { useMemo, type ComponentProps } from 'react';
import { ChatPageLazy as ChatPage } from '../../modules/chat/lazy';
import { useAllWorkspaceNodeList } from '../../modules/workspace-nodes';
import { buildKnowledgeChatContext } from '../shell/Workbench/knowledgeChatContext';
import type { WorkspaceEntry } from '../../shared/workspaces';

type Props = Omit<ComponentProps<typeof ChatPage>, 'allWorkspaces' | 'knowledgeNodes' | 'knowledgeTags'> & {
  allWorkspaces: WorkspaceEntry[];
};

/** The /chat page. Its global scope offers the same knowledge @ mentions as
 * the dock's global chat, so one conversation keeps one capability set. */
export const ChatRoute = ({ allWorkspaces, ...props }: Props) => {
  const { nodes, tags } = useAllWorkspaceNodeList(allWorkspaces);
  const { knowledgeNodes, knowledgeTags } = useMemo(
    () => buildKnowledgeChatContext(nodes, tags, null),
    [nodes, tags],
  );
  return (
    <ChatPage
      {...props}
      allWorkspaces={allWorkspaces}
      knowledgeNodes={knowledgeNodes}
      knowledgeTags={knowledgeTags}
    />
  );
};
