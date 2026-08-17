import { useCallback, useLayoutEffect, useRef } from 'react';
import type { AgentContextTabRef, AgentRequestContext, CanvasNode } from '../../../types';
import { useCanvasModels } from '../ModelSettings';
import type { AgentScope, WorkspaceOption } from '../types';
import { useChatSessions } from './useChatSessions';
import { useChatStream } from './useChatStream';
import { useMentions } from './useMentions';
import { createChatConversationMutationState } from './chatConversationMutation';

interface UseChatComposerStateOptions {
  agentScope: AgentScope;
  scopeLabel?: string;
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
  scopeLabel,
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
  const activeSessionChangeRef = useRef<((sessionId: string) => void) | null>(null);
  const conversationSessionIdRef = useRef<string | null>(null);
  const refreshContinuedTurnRef = useRef<(() => void) | null>(null);
  const refreshContinuedTurn = useCallback(() => refreshContinuedTurnRef.current?.(), []);
  const conversationEpochRef = useRef(0);
  const conversationMutationRef = useRef(createChatConversationMutationState());
  const adoptConversationSession = useCallback((sessionId: string | null) => {
    if (conversationSessionIdRef.current === sessionId) return;
    conversationSessionIdRef.current = sessionId;
    conversationEpochRef.current += 1;
  }, []);
  const handleActiveSessionChange = useCallback((sessionId: string) => {
    // Branching immediately starts the replacement turn after main makes the
    // new conversation durable. React state adoption renders later, so hand
    // the CAS pointer off synchronously before sendMessage reads this ref.
    adoptConversationSession(sessionId);
    activeSessionChangeRef.current?.(sessionId);
  }, [adoptConversationSession]);

  const chatStream = useChatStream({
    agentScope,
    allWorkspaces,
    modelLabel: canvasModels.selectedLabel,
    scopeLabel,
    onActiveSessionChange: handleActiveSessionChange,
    conversationSessionIdRef,
    conversationEpochRef,
    conversationMutationRef,
    onContinuedTurn: refreshContinuedTurn,
  });

  const chatSessions = useChatSessions({
    agentScope,
    allWorkspaces,
    onMessagesLoaded: chatStream.replaceMessages,
    eagerLoad,
    skipInitialHistory,
    conversationMutationRef,
    onConversationMutationStart: chatStream.retireCurrentTurn,
  });
  activeSessionChangeRef.current = chatSessions.adoptActiveSession;
  refreshContinuedTurnRef.current = () => { void chatSessions.refreshHistory(); };
  useLayoutEffect(() => {
    adoptConversationSession(chatSessions.activeSessionId);
  }, [adoptConversationSession, chatSessions.activeSessionId]);

  // A turn must not be sent into a conversation that is still being fetched:
  // the thread on screen is a skeleton and the main-side session pointer is
  // mid-swap, so the message could land in either session. Mirror image of the
  // rule the surfaces already apply the other way round (session switches are
  // blocked while a turn streams). Read through a ref so the composer's
  // callbacks stay stable while the flag flips.
  const sessionLoadingRef = useRef(false);
  sessionLoadingRef.current = chatSessions.sessionLoading;
  const sessionErrorRef = useRef(false);
  sessionErrorRef.current = chatSessions.sessionError !== null;
  const isSubmitBlocked = useCallback(
    () => (
      sessionLoadingRef.current
      || sessionErrorRef.current
      || conversationMutationRef.current.busy
    ),
    [],
  );

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
    onSubmitDuringRun: chatStream.submitRunInput,
    getRequestContext,
    isSubmitBlocked,
  });

  return {
    ...chatStream,
    ...chatSessions,
    ...mentions,
    canvasModels,
  };
}
