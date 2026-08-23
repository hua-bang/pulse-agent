import { useMemo } from 'react';
import type { WorkspaceEntry } from '../../../hooks/useWorkspaces';
import type {
  AgentContextCanvasRef,
  AgentContextNodeRef,
  AgentContextTagRef,
  KnowledgeNodeSelection,
} from '../../../types';
import type { SettingsSection } from '../../settings/Settings';
import { ChatPanelLazy as ChatPanel } from '../../chat/lazy';
import type { AgentScope, ChatComposerRequest } from '../../chat/types';
import { useAllWorkspaceNodeList } from '../../../views/WorkspaceNodes/useWorkspaceNodes';
import { buildKnowledgeChatContext } from './knowledgeChatContext';

const GLOBAL_AGENT_SCOPE: AgentScope = { kind: 'global' };
const EMPTY_CONTEXT_NODES: AgentContextNodeRef[] = [];

interface Props {
  selectedNode: KnowledgeNodeSelection | null;
  contextNodes?: AgentContextNodeRef[];
  contextTags?: AgentContextTagRef[];
  contextCanvases?: AgentContextCanvasRef[];
  composerRequest?: ChatComposerRequest;
  onComposerRequestHandled?: (requestId: string) => void;
  onRemoveContext?: (key: string) => void;
  workspaces: WorkspaceEntry[];
  onClose: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
  onTurnComplete: () => void;
  chatTargetActive?: boolean;
  onOpenSessionInScope?: (scope: AgentScope, sessionId: string, scopeLabel: string) => void;
}

/** Hosts the knowledge routes' global ChatPanel in the one application RightDock. */
export const KnowledgeChatPortal = ({
  selectedNode,
  contextNodes,
  contextTags,
  contextCanvases,
  composerRequest,
  onComposerRequestHandled,
  onRemoveContext,
  workspaces,
  onClose,
  onOpenAppSettings,
  onTurnComplete,
  chatTargetActive,
  onOpenSessionInScope,
}: Props) => {
  const { nodes, tags } = useAllWorkspaceNodeList(workspaces);
  const selectedWorkspaceId = selectedNode?.workspaceId;
  const selectedNodeId = selectedNode?.nodeId;
  const chatContext = useMemo(
    () => buildKnowledgeChatContext(nodes, tags, selectedNode),
    [nodes, selectedNodeId, selectedWorkspaceId, tags],
  );
  // An explicit scope may intentionally contain only a tag or workspace.
  // Presence, rather than a non-empty node list, decides whether to retain
  // it instead of silently falling back to the currently opened detail node.
  const hasExplicitContext = contextNodes !== undefined
    || contextTags !== undefined
    || contextCanvases !== undefined;
  const resolvedContextNodes = hasExplicitContext
    ? (contextNodes ?? EMPTY_CONTEXT_NODES)
    : chatContext.contextNodes;

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
        onComposerRequestHandled={onComposerRequestHandled}
        onRemoveContext={onRemoveContext}
        onClose={onClose}
        onOpenAppSettings={onOpenAppSettings}
        onTurnComplete={onTurnComplete}
        chatTargetActive={chatTargetActive}
        onOpenSessionInScope={onOpenSessionInScope}
      />
    </div>
  );
};
