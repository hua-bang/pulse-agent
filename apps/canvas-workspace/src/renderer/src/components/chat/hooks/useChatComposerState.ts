import type { AgentContextTabRef, AgentRequestContext, CanvasNode } from '../../../types';
import { useCanvasModels } from '../ModelSettings';
import type { AgentScope, WorkspaceOption } from '../types';
import { useChatSessions } from './useChatSessions';
import { useChatStream } from './useChatStream';
import { useExternalChatSend } from './useExternalChatSend';
import { useMentions } from './useMentions';

interface UseChatComposerStateOptions {
  agentScope: AgentScope;
  allWorkspaces?: WorkspaceOption[];
  nodes?: CanvasNode[];
  rootFolder?: string;
  /** Forwarded to useMentions — cross-workspace knowledge candidates for `@`. */
  knowledgeNodes?: Array<{ id: string; title: string; type: CanvasNode['type']; workspaceId?: string }>;
  knowledgeTags?: Array<{ id: string; name: string; workspaceIds?: string[] }>;
  /** Forwarded to useMentions — open right-dock tabs for the `@` popup. */
  dockTabs?: AgentContextTabRef[];
  /** Forwarded to useMentions — collect structured context from inline chips at send. */
  collectStructuredContext?: boolean;
  /** Forwarded to useChatSessions — load the session list on mount + workspace change. */
  eagerLoad?: boolean;
  /** Forwarded to useChatSessions — skip the initial getHistory call. */
  skipInitialHistory?: boolean;
  /** Forwarded to useMentions — lets callers thread per-submit request context (selected nodes, executionMode, …). */
  getRequestContext?: () => AgentRequestContext | undefined;
}

/**
 * Wires up the shared chat-surface state (streaming, sessions, mentions,
 * model picker) used by both the right-side ChatPanel and the full-screen
 * ChatPage. Each caller renders its own layout chrome (resize handle /
 * session rail / header) around the returned state.
 *
 * Prompt profile and global-settings open state aren't here anymore:
 * they live in the top-level Settings drawer, opened via an
 * `onOpenAppSettings(section)` callback threaded down from App.
 */
export function useChatComposerState({
  agentScope,
  allWorkspaces,
  nodes,
  rootFolder,
  knowledgeNodes,
  knowledgeTags,
  dockTabs,
  collectStructuredContext,
  eagerLoad,
  skipInitialHistory,
  getRequestContext,
}: UseChatComposerStateOptions) {
  const canvasModels = useCanvasModels();

  const chatStream = useChatStream({ agentScope, allWorkspaces });
  useExternalChatSend(agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined, chatStream.sendMessage);

  const chatSessions = useChatSessions({
    agentScope,
    allWorkspaces,
    onMessagesLoaded: chatStream.replaceMessages,
    eagerLoad,
    skipInitialHistory,
  });

  const mentions = useMentions({
    allWorkspaces,
    agentScope,
    nodes,
    rootFolder,
    knowledgeNodes,
    knowledgeTags,
    dockTabs,
    collectStructuredContext,
    onSubmit: chatStream.sendMessage,
    getRequestContext,
  });

  return {
    ...chatStream,
    ...chatSessions,
    ...mentions,
    canvasModels,
  };
}
