import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react';
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
import { conversationKeyId, type ConversationKey } from '../../../../../shared/conversation-runtime';
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
const EMPTY_MESSAGE_TOOLS = new Map<number, ToolCallStatus[]>();
const EMPTY_EXPANDED_TOOLS = new Set<number>();

interface ClarifyState {
  input: string;
  answering: boolean;
  error: string | null;
}

const EMPTY_CLARIFY: ClarifyState = { input: '', answering: false, error: null };

const resolveUpdater = <T,>(updater: SetStateAction<T>, current: T): T => (
  typeof updater === 'function' ? (updater as (prev: T) => T)(current) : updater
);

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
  const ownerId = conversationKeyId(key);
  const snapshot = useConversationSnapshot(key);
  const [clarifyByOwner, setClarifyByOwner] = useState<Map<string, ClarifyState>>(() => new Map());
  const [expandedToolsByOwner, setExpandedToolsByOwner] = useState<Map<string, Set<number>>>(() => new Map());
  // Explicit section toggles, per conversation. Defaults come from the
  // messages, so a streamed text batch never undoes what the user opened.
  const [sectionToggles, setSectionToggles] = useState<{ owner: string; collapsed: Map<number, boolean> }>(
    () => ({ owner: '', collapsed: new Map() }),
  );
  const [messageToolsByOwner, setMessageToolsByOwner] = useState<Map<string, Map<number, ToolCallStatus[]>>>(
    () => new Map(),
  );
  const [relayByOwner, setRelayByOwner] = useState<Map<string, RelayProgress>>(() => new Map());
  const onTurnCompleteRef = useRef(onTurnComplete);
  onTurnCompleteRef.current = onTurnComplete;
  const onSessionChangedRef = useRef(onSessionChanged);
  onSessionChangedRef.current = onSessionChanged;
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const toolIdCounter = useRef(0);
  useConversationVisibility(key, keyed && visible);

  const updateMessageToolsForOwner = useCallback((
    targetOwnerId: string,
    updater: SetStateAction<Map<number, ToolCallStatus[]>>,
  ) => {
    setMessageToolsByOwner(prev => {
      const current = prev.get(targetOwnerId) ?? EMPTY_MESSAGE_TOOLS;
      const nextValue = resolveUpdater(updater, current);
      if (nextValue === current) return prev;
      const next = new Map(prev);
      if (nextValue.size === 0) next.delete(targetOwnerId);
      else next.set(targetOwnerId, nextValue);
      return next;
    });
  }, []);

  const updateRelayForOwner = useCallback((
    targetOwnerId: string,
    updater: SetStateAction<RelayProgress | null>,
  ) => {
    setRelayByOwner(prev => {
      const current = prev.get(targetOwnerId) ?? null;
      const nextValue = resolveUpdater(updater, current);
      if (nextValue === current) return prev;
      const next = new Map(prev);
      if (nextValue === null) next.delete(targetOwnerId);
      else next.set(targetOwnerId, nextValue);
      return next;
    });
  }, []);

  const updateClarifyForOwner = useCallback((
    targetOwnerId: string,
    patch: Partial<ClarifyState>,
  ) => {
    setClarifyByOwner(prev => {
      const current = prev.get(targetOwnerId) ?? EMPTY_CLARIFY;
      const nextState: ClarifyState = { ...current, ...patch };
      const next = new Map(prev);
      if (!nextState.input && !nextState.answering && !nextState.error) next.delete(targetOwnerId);
      else next.set(targetOwnerId, nextState);
      return next;
    });
  }, []);

  const observerHooks = useMemo<TurnObserverHooks>(() => ({
    toolIdCounter,
    setMessageTools: updateMessageToolsForOwner,
    setRelay: updateRelayForOwner,
    onTurnComplete: () => onTurnCompleteRef.current?.(),
    onSessionChanged: (error) => onSessionChangedRef.current?.(error),
  }), [updateMessageToolsForOwner, updateRelayForOwner]);

  // A turn can outlive this renderer's stream (reload, another window). When
  // a conversation opens, reconnect to a turn main is still running.
  const agentScopeRef = useRef(agentScope);
  agentScopeRef.current = agentScope;
  useEffect(() => {
    if (!keyed || !key.sessionId) return;
    void attachConversationTurn(agentScopeRef.current, { storeId: key.storeId, sessionId: key.sessionId }, observerHooks);
  }, [key.sessionId, key.storeId, keyed, observerHooks]);

  useEffect(() => {
    const nextTools = new Map(
      snapshot.messages.flatMap((message, index) => (
        message.role === 'assistant' && message.toolCalls?.length
          ? [[index, message.toolCalls]] as Array<[number, ToolCallStatus[]]>
          : []
      )),
    );
    updateMessageToolsForOwner(ownerId, nextTools);
  }, [ownerId, snapshot.messages, updateMessageToolsForOwner]);

  const clarifyState = clarifyByOwner.get(ownerId) ?? EMPTY_CLARIFY;
  const clarifyInput = clarifyState.input;
  const clarificationAnswering = clarifyState.answering;
  const clarificationError = clarifyState.error;
  const expandedTools = expandedToolsByOwner.get(ownerId) ?? EMPTY_EXPANDED_TOOLS;
  const messageTools = messageToolsByOwner.get(ownerId) ?? EMPTY_MESSAGE_TOOLS;
  const relay = relayByOwner.get(ownerId) ?? null;

  const setClarifyInput = useCallback((value: string) => {
    updateClarifyForOwner(ownerId, { input: value });
  }, [ownerId, updateClarifyForOwner]);

  const sectionOwner = ownerId;
  const messageCount = snapshot.messages.length;
  const collapsedSections = useMemo(() => {
    const toggles = sectionToggles.owner === sectionOwner ? sectionToggles.collapsed : null;
    return new Set(snapshot.messages.flatMap((message, index) => {
      const collapsedByDefault = message.role === 'assistant' && !!message.toolCalls?.length;
      return (toggles?.get(index) ?? collapsedByDefault) ? [index] : [];
    }));
  }, [sectionOwner, sectionToggles, snapshot.messages]);
  const collapsedSectionsRef = useRef(collapsedSections);
  collapsedSectionsRef.current = collapsedSections;

  // Edit/regenerate cut the thread; a later message at a cut index starts
  // from its default again.
  useEffect(() => {
    setSectionToggles((prev) => {
      if (prev.owner !== sectionOwner) return prev;
      if (![...prev.collapsed.keys()].some((index) => index >= messageCount)) return prev;
      return {
        owner: prev.owner,
        collapsed: new Map([...prev.collapsed].filter(([index]) => index < messageCount)),
      };
    });
  }, [messageCount, sectionOwner]);

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
    const targetOwnerId = ownerId;
    const answer = (answerOverride ?? clarifyInput).trim();
    if (!answer) return;
    updateClarifyForOwner(targetOwnerId, { error: null, answering: true });
    try {
      const result = await window.canvasWorkspace.agent.conversationClarifyAnswer(
        agentScope, key.sessionId, pending.id, answer,
      );
      if (!result.ok) {
        updateClarifyForOwner(targetOwnerId, {
          error: result.error ?? 'Failed to deliver clarification answer',
        });
        return;
      }
      setConversationClarification(key, null);
      updateClarifyForOwner(targetOwnerId, { input: '', error: null });
    } catch (error) {
      updateClarifyForOwner(targetOwnerId, {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      updateClarifyForOwner(targetOwnerId, { answering: false });
    }
  }, [agentScope, clarifyInput, key, keyed, ownerId, snapshot.clarification, updateClarifyForOwner]);

  const toggleSection = useCallback((messageIndex: number) => {
    const collapsed = !collapsedSectionsRef.current.has(messageIndex);
    setSectionToggles(prev => ({
      owner: sectionOwner,
      collapsed: new Map(prev.owner === sectionOwner ? prev.collapsed : []).set(messageIndex, collapsed),
    }));
  }, [sectionOwner]);
  const toggleToolExpand = useCallback((toolId: number) => {
    setExpandedToolsByOwner(prev => {
      const current = prev.get(ownerId) ?? EMPTY_EXPANDED_TOOLS;
      const nextSet = new Set(current);
      if (nextSet.has(toolId)) nextSet.delete(toolId);
      else nextSet.add(toolId);
      const next = new Map(prev);
      if (nextSet.size === 0) next.delete(ownerId);
      else next.set(ownerId, nextSet);
      return next;
    });
  }, [ownerId]);

  // ChatPanel-compatible extras (multi-role relay, image insert, branching,
  // run queue). In the conversation-runtime architecture these are thin
  // wrappers over the same IPC the legacy hook uses; switching is just a
  // selector, and a lost stream reattaches through main's snapshot.
  const stopRelay = useCallback(async (): Promise<boolean> => {
    if (!keyed || snapshot.status !== 'running') return false;
    const targetOwnerId = ownerId;
    updateRelayForOwner(targetOwnerId, current => (current ? { ...current, stopping: true } : current));
    try {
      const result = await window.canvasWorkspace.agent.conversationStopRelay(agentScope, key.sessionId);
      if (!result.ok) {
        updateRelayForOwner(targetOwnerId, current => (current ? { ...current, stopping: false } : current));
      }
      return result.ok;
    } catch {
      updateRelayForOwner(targetOwnerId, current => (current ? { ...current, stopping: false } : current));
      return false;
    }
  }, [agentScope, key.sessionId, keyed, ownerId, snapshot.status, updateRelayForOwner]);

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
    /** False until a session key exists; `sendMessage` refuses before then. */
    conversationReady: keyed,
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
