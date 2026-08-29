import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AgentContextTabRef, AgentRequestContext, CanvasNode } from '../../../types';
import type { AgentScope, WorkspaceOption } from '../types';
import type { ConversationKey } from '../../../../../shared/conversation-runtime';
import { useCanvasModels } from '../ModelSettings';
import { useChatSessions } from './useChatSessions';
import { useConversationRuntimeStream } from './useConversationRuntimeStream';
import { useMentions } from './useMentions';
import { conversationKeyFromScope } from './useConversationRuntimeStream';
import {
  captureConversationSequences,
  hydrateConversationMessages,
  setConversationError,
} from './conversationStore';
import type { LoadedConversation } from './loadedConversationSink';

interface UseChatComposerStateKeyedOptions {
  agentScope: AgentScope;
  scopeLabel?: string;
  allWorkspaces?: WorkspaceOption[];
  nodes?: CanvasNode[];
  rootFolder?: string;
  knowledgeNodes?: Array<{ id: string; title: string; type: CanvasNode['type']; workspaceId?: string }>;
  knowledgeTags?: Array<{ id: string; name: string; workspaceIds?: string[] }>;
  dockTabs?: AgentContextTabRef[];
  collectStructuredContext?: boolean;
  eagerLoad?: boolean;
  skipInitialHistory?: boolean;
  getRequestContext?: () => AgentRequestContext | undefined;
  /** Test/integration seam: pin the conversation selector without a history load. */
  conversationKeyOverride?: string | null;
  conversationVisible?: boolean;
}

/**
 * Phase-3/4 composer root for the conversation-runtime architecture. Mirrors
 * the legacy `useChatComposerState` shape but drives stream state through the
 * conversation-keyed store: the selected conversation is the store selector,
 * so Dock Chat and Full-page Chat mounting the same scope share the same
 * snapshot and switching conversations never destroys/replays a sibling's
 * state. No turn lease / scope owner / reattach / replay compensation chains.
 */
export function useChatComposerStateKeyed({
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
  conversationKeyOverride,
  conversationVisible,
}: UseChatComposerStateKeyedOptions) {
  const canvasModels = useCanvasModels();
  const [conversationSessionId, setConversationSessionId] = useState<string | null>(
    conversationKeyOverride ?? null,
  );
  const conversationKey: ConversationKey | undefined = conversationSessionId
    ? conversationKeyFromScope(agentScope, conversationSessionId)
    : undefined;
  const changedSessionRecoveryRef = useRef<(
    error: string,
  ) => Promise<{ sessionId: string; error: string } | null>>();

  const recoverChangedSession = useCallback(async (error: string) => {
    const recovered = await changedSessionRecoveryRef.current?.(error);
    if (!recovered) return;
    setConversationError(
      conversationKeyFromScope(agentScope, recovered.sessionId),
      recovered.error,
    );
  }, [agentScope]);

  const chatStream = useConversationRuntimeStream({
    agentScope,
    allWorkspaces,
    conversationKey,
    visible: conversationVisible,
    onSessionChanged: recoverChangedSession,
    onTurnComplete: () => {
      if (sessionListRefreshTimerRef.current) window.clearTimeout(sessionListRefreshTimerRef.current);
      sessionListRefreshTimerRef.current = window.setTimeout(() => {
        sessionListRefreshTimerRef.current = undefined;
        loadSessionsRef.current?.();
      }, 150);
    },
  });

  const handleConversationLoaded = useCallback((loaded: LoadedConversation) => {
    hydrateConversationMessages(
      conversationKeyFromScope(loaded.scope, loaded.sessionId),
      loaded.messages,
      loaded.expectedSequence,
    );
  }, []);
  const handleConversationLoadStart = useCallback((scope: AgentScope) => (
    captureConversationSequences(conversationKeyFromScope(scope, '').storeId)
  ), []);

  const chatSessions = useChatSessions({
    agentScope,
    allWorkspaces,
    onConversationLoaded: handleConversationLoaded,
    onConversationLoadStart: handleConversationLoadStart,
    eagerLoad,
    skipInitialHistory,
  });
  changedSessionRecoveryRef.current = chatSessions.recoverChangedSession;

  const loadSessionsRef = useRef(chatSessions.loadSessions);
  loadSessionsRef.current = chatSessions.loadSessions;
  const sessionListRefreshTimerRef = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    if (sessionListRefreshTimerRef.current) window.clearTimeout(sessionListRefreshTimerRef.current);
  }, []);

  // Adopt the session the rail/history resolved so the store selector follows
  // the selected conversation.
  useLayoutEffect(() => {
    if (conversationKeyOverride !== undefined) {
      setConversationSessionId(conversationKeyOverride);
      return;
    }
    if (chatSessions.activeSessionId) {
      setConversationSessionId(chatSessions.activeSessionId);
    }
  }, [chatSessions.activeSessionId, conversationKeyOverride]);

  const sessionLoadingRef = useRef(false);
  sessionLoadingRef.current = chatSessions.sessionLoading;
  const sessionErrorRef = useRef(false);
  sessionErrorRef.current = chatSessions.sessionError !== null;
  const isSubmitBlocked = useCallback(
    () => sessionLoadingRef.current || sessionErrorRef.current,
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
