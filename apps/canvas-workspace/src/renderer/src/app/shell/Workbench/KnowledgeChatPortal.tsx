import { useCallback, useMemo, useState } from 'react';
import type { WorkspaceEntry } from '../../../shared/workspaces';
import type {
  AgentContextCanvasRef,
  AgentContextNodeRef,
  AgentContextScheduledTaskRef,
  AgentContextTagRef,
  KnowledgeNodeSelection,
} from '../../../types';
import type { SettingsSection } from '../../../modules/settings';
import { ChatPanelLazy as ChatPanel } from '../../../modules/chat/lazy';
import type { AgentScope } from '../../../types';
import type { ChatComposerRequest } from '../../../modules/chat';
import { useAllWorkspaceNodeList } from '../../../modules/workspace-nodes';
import { buildKnowledgeChatContext } from './knowledgeChatContext';

const GLOBAL_AGENT_SCOPE: AgentScope = { kind: 'global' };
const EMPTY_CONTEXT_NODES: AgentContextNodeRef[] = [];

// Matches the chip key ChatPanel builds for a node context ref.
const contextNodeKey = (node: AgentContextNodeRef): string => `node:${node.workspaceId ?? ''}:${node.id}`;

interface Props {
  knowledgeMode: boolean;
  selectedNode: KnowledgeNodeSelection | null;
  contextNodes?: AgentContextNodeRef[];
  contextTags?: AgentContextTagRef[];
  contextCanvases?: AgentContextCanvasRef[];
  contextScheduledTasks?: AgentContextScheduledTaskRef[];
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

/** Hosts the global ChatPanel for every non-canvas route in the one application RightDock. */
export const KnowledgeChatPortal = ({
  knowledgeMode,
  selectedNode,
  contextNodes,
  contextTags,
  contextCanvases,
  contextScheduledTasks,
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
  // The opened node is shown as a chip the user can remove. That chip is
  // derived, not stored, so remember the removal until the selection changes.
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const derivedContextNodes = useMemo(
    () => chatContext.contextNodes.filter((node) => contextNodeKey(node) !== dismissedKey),
    [chatContext.contextNodes, dismissedKey],
  );
  const resolvedContextNodes = hasExplicitContext
    ? (contextNodes ?? EMPTY_CONTEXT_NODES)
    : derivedContextNodes;
  const handleRemoveContext = useCallback((key: string) => {
    if (chatContext.contextNodes.some((node) => contextNodeKey(node) === key)) setDismissedKey(key);
    onRemoveContext?.(key);
  }, [chatContext.contextNodes, onRemoveContext]);

  return (
    <div className="right-dock__chat-instance">
      <ChatPanel
        agentScope={GLOBAL_AGENT_SCOPE}
        knowledgeMode={knowledgeMode}
        allWorkspaces={workspaces}
        knowledgeNodes={chatContext.knowledgeNodes}
        knowledgeTags={chatContext.knowledgeTags}
        contextNodes={resolvedContextNodes}
        contextTags={contextTags}
        contextCanvases={contextCanvases}
        contextScheduledTasks={contextScheduledTasks}
        composerRequest={composerRequest}
        onComposerRequestHandled={onComposerRequestHandled}
        onRemoveContext={handleRemoveContext}
        onClose={onClose}
        onOpenAppSettings={onOpenAppSettings}
        onTurnComplete={onTurnComplete}
        chatTargetActive={chatTargetActive}
        onOpenSessionInScope={onOpenSessionInScope}
      />
    </div>
  );
};
