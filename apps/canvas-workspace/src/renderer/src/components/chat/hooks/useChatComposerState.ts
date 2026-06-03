import type { AgentRequestContext, CanvasNode } from '../../../types';
import { useCanvasModels } from '../ModelSettings';
import type { AgentScope, WorkspaceOption } from '../types';
import { useChatSessions } from './useChatSessions';
import { useChatStream } from './useChatStream';
import { useMentions } from './useMentions';

interface UseChatComposerStateOptions {
  agentScope: AgentScope;
  allWorkspaces?: WorkspaceOption[];
  nodes?: CanvasNode[];
  rootFolder?: string;
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
  eagerLoad,
  skipInitialHistory,
  getRequestContext,
}: UseChatComposerStateOptions) {
  const canvasModels = useCanvasModels();

  const chatStream = useChatStream({ agentScope, allWorkspaces });

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
