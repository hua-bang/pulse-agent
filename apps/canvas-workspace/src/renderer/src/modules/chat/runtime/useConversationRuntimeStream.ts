import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AgentChatMessage,
  AgentRequestContext,
  AgentScope,
  ChatImageAttachment,
  PendingClarification,
  RelayProgress,
  ToolCallStatus,
  WorkspaceOption,
} from '../../../types';
import type { ConversationKey } from '../../../../../shared/conversation-runtime';
import {
  readConversationSnapshot,
  setConversationClarification,
  setConversationError,
  setConversationLoading,
  setConversationMessages,
  startConversationTurn,
  useConversationSnapshot,
} from './conversationStore';
import { extractMentionedWorkspaceIds } from '../mentions/extractMentionedWorkspaceIds';
import { useChatRunQueue } from './useChatRunQueue';
import { clearConversationCompletion, useConversationVisibility } from './conversationCompletionStore';
import { useConversationRecovery } from './useConversationRecovery';
import { attachConversationTurn, observeConversationTurn, type TurnObserverHooks } from './conversationTurnObserver';

export interface UseConversationRuntimeStreamOptions {
  agentScope: AgentScope;
  allWorkspaces?: WorkspaceOption[];
  /** Fired on turn complete so the session rail refreshes previews. */
  onTurnComplete?: () => void;
  /** Restore the authoritative current conversation after a stale-session rejection. */
  onSessionChanged?: (error: string) => void | Promise<void>;
  /**
   * The conversation whose run state this surface drives. Optional so a
   * parent composer can mount before the session id is known; an empty key
   * yields an empty (idle) stream and sendMessage is a no-op until the key is
   * supplied — the caller re-renders with a real key once it resolves.
   */
  conversationKey?: ConversationKey;
  visible?: boolean;
}

const toPending = (c: PendingClarification | null): PendingClarification | null => c;

const EMPTY_KEY: ConversationKey = { storeId: '', sessionId: '' };

/** Conversation-keyed stream backed by the shared renderer conversation store. */
export function useConversationRuntimeStream({
  agentScope,
  allWorkspaces,
  onTurnComplete,
  onSessionChanged,
  conversationKey,
  visible = true,
}: UseConversationRuntimeStreamOptions) {
  const key = conversationKey ?? EMPTY_KEY;
  const keyed = conversationKey !== undefined;
  const snapshot = useConversationSnapshot(key);
  const [clarifyInput, setClarifyInput] = useState('');
  const [clarificationAnswering, setClarificationAnswering] = useState(false);
  const [clarificationError, setClarificationError] = useState<string | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const [messageTools, setMessageTools] = useState<Map<number, ToolCallStatus[]>>(new Map());
  const onTurnCompleteRef = useRef(onTurnComplete);
  onTurnCompleteRef.current = onTurnComplete;
  const onSessionChangedRef = useRef(onSessionChanged);
  onSessionChangedRef.current = onSessionChanged;
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const toolIdCounter = useRef(0);
  const [relay, setRelay] = useState<RelayProgress | null>(null);
  useConversationVisibility(key, keyed && visible);
  const observerHooks = useMemo<TurnObserverHooks>(() => ({
    toolIdCounter,
    setMessageTools,
    setRelay,
    onTurnComplete: () => onTurnCompleteRef.current?.(),
    onSessionChanged: (error) => onSessionChangedRef.current?.(error),
  }), []);

  // A turn can outlive this renderer's stream (reload, another window). When
  // a conversation opens, reconnect to a turn main is still running.
  const agentScopeRef = useRef(agentScope);
  agentScopeRef.current = agentScope;
  useEffect(() => {
    if (!keyed || !key.sessionId) return;
    void attachConversationTurn(agentScopeRef.current, { storeId: key.storeId, sessionId: key.sessionId }, observerHooks);
  }, [key.sessionId, key.storeId, keyed, observerHooks]);

  useEffect(() => {
    setMessageTools(new Map(
      snapshot.messages.flatMap((message, index) => (
        message.role === 'assistant' && message.toolCalls?.length
          ? [[index, message.toolCalls]] as Array<[number, ToolCallStatus[]]>
          : []
      )),
    ));
    setCollapsedSections(new Set(
      snapshot.messages.flatMap((message, index) => (
        message.role === 'assistant' && message.toolCalls?.length ? [index] : []
      )),
    ));
  }, [snapshot.messages]);

  const sendMessage = useCallback(async (
    text: string,
    requestContext?: AgentRequestContext,
    attachments: ChatImageAttachment[] = [],
    truncateAt?: number,
  ): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return false;
    if (!keyed) return false;
    if (readConversationSnapshot(key).status === 'running') return false;

    const runId = crypto.randomUUID();
    const userMessage: AgentChatMessage = {
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    // Edit/regenerate cut the thread optimistically; restore it if main refuses.
    const beforeRecovery = truncateAt === undefined ? null : readConversationSnapshot(key).messages;
    const restoreRecovery = () => { if (beforeRecovery) setConversationMessages(key, beforeRecovery); };
    if (beforeRecovery) setConversationMessages(key, beforeRecovery.slice(0, truncateAt));
    startConversationTurn(key, userMessage);
    clearConversationCompletion(key);

    const mentionedWorkspaceIds = workspaceId
      ? extractMentionedWorkspaceIds(trimmed, allWorkspaces, workspaceId)
      : extractMentionedWorkspaceIds(trimmed, allWorkspaces, '');

    // Stream events are keyed by the conversation's own sessionId (no separate
    // prepared run id), so the observer installs BEFORE starting.
    const observer = observeConversationTurn({
      key,
      runId,
      title: trimmed.slice(0, 60),
      completionId: `${key.storeId}:${key.sessionId}:${userMessage.timestamp}`,
      restoreRecovery,
    }, observerHooks);

    try {
      const started = await window.canvasWorkspace.agent.conversationChat(
        agentScope,
        key.sessionId,
        trimmed,
        mentionedWorkspaceIds,
        { ...requestContext, expectedConversationSessionId: key.sessionId },
        attachments,
        truncateAt,
        { runId, submittedAt: userMessage.timestamp },
      );
      if (!started.ok) {
        restoreRecovery();
        setConversationError(key, started.error ?? 'Chat turn failed to start');
        setConversationLoading(key, false);
        observer.dispose();
        return false;
      }
      return true;
    } catch (error) {
      restoreRecovery();
      observer.dispose();
      setConversationError(key, error instanceof Error ? error.message : String(error));
      setConversationLoading(key, false);
      return false;
    }
  }, [agentScope, allWorkspaces, key, keyed, observerHooks, snapshot.status, workspaceId]);

  const abort = useCallback(async (): Promise<boolean> => {
    if (!keyed || snapshot.status !== 'running') return false;
    const result = await window.canvasWorkspace.agent.conversationAbort(agentScope, key.sessionId);
    return result.ok;
  }, [agentScope, key, keyed, snapshot.status]);

  const answerClarification = useCallback(async (answerOverride?: string): Promise<void> => {
    const pending = snapshot.clarification;
    if (!pending || !keyed) return;
    const answer = (answerOverride ?? clarifyInput).trim();
    if (!answer) return;
    setClarificationError(null);
    setClarificationAnswering(true);
    try {
      const result = await window.canvasWorkspace.agent.conversationClarifyAnswer(
        agentScope, key.sessionId, pending.id, answer,
      );
      if (!result.ok) {
        setClarificationError(result.error ?? 'Failed to deliver clarification answer');
        return;
      }
      setConversationClarification(key, null);
      setClarifyInput('');
    } catch (error) {
      setClarificationError(error instanceof Error ? error.message : String(error));
    } finally {
      setClarificationAnswering(false);
    }
  }, [agentScope, clarifyInput, key, keyed, snapshot.clarification]);

  const toggleSection = useCallback((messageIndex: number) => {
    setCollapsedSections(prev => {
      const next = new Set(prev);
      if (next.has(messageIndex)) next.delete(messageIndex);
      else next.add(messageIndex);
      return next;
    });
  }, []);
  const toggleToolExpand = useCallback((toolId: number) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      return next;
    });
  }, []);

  // ChatPanel-compatible extras (multi-role relay, image insert, branching,
  // run queue). In the conversation-runtime architecture these are thin
  // wrappers over the same IPC the legacy hook uses; switching is just a
  // selector, and a lost stream reattaches through main's snapshot.
  const stopRelay = useCallback(async (): Promise<boolean> => {
    if (!keyed || snapshot.status !== 'running') return false;
    const result = await window.canvasWorkspace.agent.conversationStopRelay(agentScope, key.sessionId);
    return result.ok;
  }, [agentScope, key.sessionId, keyed, snapshot.status]);

  const addImageToCanvas = useCallback(async (imagePath: string, title?: string): Promise<void> => {
    if (agentScope.kind !== 'workspace') return;
    await window.canvasWorkspace.agent.addImageToCanvas(agentScope.workspaceId, imagePath, title);
  }, [agentScope]);

  const conversationError = snapshot.error;

  const { editUserMessage, regenerateAssistantMessage } = useConversationRecovery(key, sendMessage);

  const sendQueuedMessage = useCallback(async (
    text: string,
    context?: AgentRequestContext,
  ): Promise<'accepted' | 'blocked' | 'failed'> => {
    const accepted = await sendMessage(text, context);
    return accepted ? 'accepted' : 'failed';
  }, [sendMessage]);

  const runQueue = useChatRunQueue({
    scopeKey: `${key.storeId}\u0000${key.sessionId}`,
    loading: snapshot.status === 'running',
    busyElsewhere: false,
    abort,
    getConversationSessionId: () => key.sessionId,
    sendMessage: sendQueuedMessage,
  });

  const disposeCurrentTurn = useCallback(() => undefined, []);
  const retireCurrentTurn = useCallback(() => undefined, []);

  return {
    abort,
    addImageToCanvas,
    answerClarification,
    busyElsewhere: false,
    clarifyInput,
    clarificationAnswering,
    clarificationError,
    conversationError,
    collapsedSections,
    disposeCurrentTurn,
    editUserMessage,
    expandedTools,
    loading: snapshot.status === 'running',
    messageTools,
    messages: snapshot.messages,
    pendingClarify: toPending(snapshot.clarification),
    regenerateAssistantMessage,
    relay,
    replaceMessages: (messages: AgentChatMessage[]) => setConversationMessages(key, messages),
    retireCurrentTurn,
    runQueue,
    sendMessage,
    setClarifyInput,
    stopRelay,
    streamingTools: snapshot.streamingTools,
    submitRunInput: runQueue.submitRunInput,
    toggleSection,
    toggleToolExpand,
  };
}
