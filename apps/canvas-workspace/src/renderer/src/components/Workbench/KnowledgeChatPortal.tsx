import { useMemo } from 'react';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type {
  AgentContextCanvasRef,
  AgentContextNodeRef,
  AgentContextTagRef,
  KnowledgeNodeSelection,
} from '../../types';
import type { SettingsSection } from '../Settings';
import { ChatPanelLazy as ChatPanel } from '../chat/lazy';
import type { AgentScope, ChatComposerRequest } from '../chat/types';
import { useAllWorkspaceNodeList } from '../WorkspaceNodes/useWorkspaceNodes';
import { buildKnowledgeChatContext } from './knowledgeChatContext';

const GLOBAL_AGENT_SCOPE: AgentScope = { kind: 'global' };

interface Props {
  selectedNode: KnowledgeNodeSelection | null;
  contextNodes?: AgentContextNodeRef[];
  contextTags?: AgentContextTagRef[];
  contextCanvases?: AgentContextCanvasRef[];
  composerRequest?: ChatComposerRequest;
  onRemoveContext?: (key: string) => void;
  workspaces: WorkspaceEntry[];
  onClose: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
  onTurnComplete: () => void;
}

/** Hosts the knowledge routes' global ChatPanel in the one application RightDock. */
export const KnowledgeChatPortal = ({
  selectedNode,
  contextNodes,
  contextTags,
  contextCanvases,
  composerRequest,
  onRemoveContext,
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
  // An explicit scope may intentionally contain only a tag or workspace.
  // Presence, rather than a non-empty node list, decides whether to retain
  // it instead of silently falling back to the currently opened detail node.
  const hasExplicitContext = contextNodes !== undefined
    || contextTags !== undefined
    || contextCanvases !== undefined;
  const resolvedContextNodes = hasExplicitContext ? (contextNodes ?? []) : chatContext.contextNodes;

  return (
    <div className="right-dock__chat-instance">
      <ChatPanel
        agentScope={GLOBAL_AGENT_SCOPE}
        knowledgeMode
        allWorkspaces={workspaces}
        knowledgeNodes={chatContext.knowledgeNodes}
        knowledgeTags={chatContext.knowledgeTags}
        contextNodes={resolvedContextNodes}
        contextTags={contextTags}
        contextCanvases={contextCanvases}
        composerRequest={composerRequest}
        onRemoveContext={onRemoveContext}
        onClose={onClose}
        onOpenAppSettings={onOpenAppSettings}
        onTurnComplete={onTurnComplete}
      />
    </div>
  );
};
