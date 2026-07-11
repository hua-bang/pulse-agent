import { useMemo } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { KnowledgeNodeSelection } from '../../types';
import type { SettingsSection } from '../Settings';
import { ChatPanelLazy as ChatPanel } from '../chat/lazy';
import type { AgentScope } from '../chat/types';
import { useAllWorkspaceNodeList } from '../WorkspaceNodes/useWorkspaceNodes';
import { buildKnowledgeChatContext } from './knowledgeChatContext';

const GLOBAL_AGENT_SCOPE: AgentScope = { kind: 'global' };

interface Props {
  selectedNode: KnowledgeNodeSelection | null;
  workspaces: WorkspaceEntry[];
  onClose: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
  onTurnComplete: () => void;
}

/** Hosts the knowledge routes' global ChatPanel in the one application RightDock. */
export const KnowledgeChatPortal = ({
  selectedNode,
  workspaces,
  onClose,
  onOpenAppSettings,
  onTurnComplete,
}: Props) => {
  const { nodes, tags } = useAllWorkspaceNodeList(workspaces);
  const chatContext = useMemo(
    () => buildKnowledgeChatContext(nodes, tags, selectedNode),
    [nodes, selectedNode, tags],
  );

  return (
    <div className="right-dock__chat-instance">
      <ChatPanel
        agentScope={GLOBAL_AGENT_SCOPE}
        knowledgeMode
        allWorkspaces={workspaces}
        knowledgeNodes={chatContext.knowledgeNodes}
        knowledgeTags={chatContext.knowledgeTags}
        contextNodes={chatContext.contextNodes}
        onClose={onClose}
        onOpenAppSettings={onOpenAppSettings}
        onTurnComplete={onTurnComplete}
      />
    </div>
  );
};
