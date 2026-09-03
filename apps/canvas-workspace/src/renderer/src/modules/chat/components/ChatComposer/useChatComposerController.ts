import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AgentContextTabRef, AgentRequestContext, CanvasNode } from '../../../../types';
import type { AgentScope, WorkspaceOption } from '../../../../types';
import { conversationKeyId, type ConversationKey } from '../../../../../../shared/conversation-runtime';
import { useCanvasModels } from '../../../../hooks/useCanvasModels';
import { useChatSessions } from '../../sessions/useChatSessions';
import { useConversationRuntimeStream } from '../../runtime/useConversationRuntimeStream';
import { useChatComposerInput } from './useChatComposerInput';
import { conversationKeyFromScope } from '../../runtime/conversationKey';
import {
  captureConversationSequences,
  hydrateConversationMessages,
  setConversationError,
} from '../../runtime/conversationStore';
import type { LoadedConversation } from '../../sessions/loadedConversationSink';
import { serializeEditable } from '../utils/mentions';

interface UseChatComposerControllerOptions {
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
export function useChatComposerController({
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
}: UseChatComposerControllerOptions) {
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

  const prewarmTimerRef = useRef<number | undefined>(undefined);
  const prewarmedConversationRef = useRef<string | null>(null);
  const prewarmScopeRef = useRef(agentScope);
  prewarmScopeRef.current = agentScope;
  const prewarmConversationId = conversationKey ? conversationKeyId(conversationKey) : null;
  const requestAgentPrewarm = useCallback(() => {
    if (!prewarmConversationId) return;
    if (prewarmedConversationRef.current === prewarmConversationId) return;
    prewarmedConversationRef.current = prewarmConversationId;
    if (prewarmTimerRef.current !== undefined) {
      window.clearTimeout(prewarmTimerRef.current);
      prewarmTimerRef.current = undefined;
    }
    window.canvasWorkspace.agent.warmScope({ scope: prewarmScopeRef.current });
  }, [prewarmConversationId]);

  useEffect(() => {
    if (prewarmTimerRef.current !== undefined) window.clearTimeout(prewarmTimerRef.current);
    prewarmTimerRef.current = undefined;
    if (
      !prewarmConversationId
      || conversationVisible === false
      || chatSessions.sessionLoading
      || chatStream.messages.length > 0
    ) return;
    prewarmTimerRef.current = window.setTimeout(() => {
      prewarmTimerRef.current = undefined;
      requestAgentPrewarm();
    }, 750);
    return () => {
      if (prewarmTimerRef.current !== undefined) window.clearTimeout(prewarmTimerRef.current);
      prewarmTimerRef.current = undefined;
    };
  }, [chatSessions.sessionLoading, chatStream.messages.length, conversationVisible, prewarmConversationId, requestAgentPrewarm]);

  const sendMessage = useCallback((...args: Parameters<typeof chatStream.sendMessage>) => {
    requestAgentPrewarm();
    return chatStream.sendMessage(...args);
  }, [chatStream.sendMessage, requestAgentPrewarm]);

  const mentions = useChatComposerInput({
    allWorkspaces,
    agentScope,
    nodes,
    rootFolder,
    knowledgeNodes,
    knowledgeTags,
    dockTabs,
    collectStructuredContext,
    onSubmit: sendMessage,
    onSubmitDuringRun: chatStream.submitRunInput,
    getRequestContext,
    isSubmitBlocked,
  });

  const handleInput = useCallback(() => {
    mentions.handleInput();
    const editable = mentions.editableRef.current;
    if (editable && serializeEditable(editable).trim()) requestAgentPrewarm();
  }, [mentions.editableRef, mentions.handleInput, requestAgentPrewarm]);
  const handlePaste = useCallback((event: Parameters<typeof mentions.handlePaste>[0]) => {
    const hasImage = Array.from(event.clipboardData.files)
      .some(file => file.type.startsWith('image/'));
    if (hasImage || event.clipboardData.getData('text/plain').trim()) requestAgentPrewarm();
    mentions.handlePaste(event);
  }, [mentions.handlePaste, requestAgentPrewarm]);
  const handleAttachFiles = useCallback((files: Parameters<typeof mentions.handleAttachFiles>[0]) => {
    if (Array.from(files).some(file => file.type.startsWith('image/'))) requestAgentPrewarm();
    mentions.handleAttachFiles(files);
  }, [mentions.handleAttachFiles, requestAgentPrewarm]);

  return {
    ...chatStream,
    ...chatSessions,
    ...mentions,
    sendMessage,
    handleInput,
    handlePaste,
    handleAttachFiles,
    canvasModels,
  };
}
