import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import type { AgentChatMessage, AgentRequestContext, ChatImageAttachment } from '../../../types';
import type { AgentScope, PendingClarification, ToolCallStatus, WorkspaceOption } from '../types';
import { extractMentionedWorkspaceIds } from '../utils/mentions';
import { markToolResult, settleRunningTools, upsertToolInputStart } from './toolStreamState';
import { subscribeVisualStream } from './visualStreamSubscription';
import {
  applyTurnCompletion,
  createRelayTurnHandlers,
  createSegmentState,
  type RelayProgress,
} from './relayTurnHandlers';
import { count } from '../../../perf/counters';
import { cacheThread, getCachedThread } from './chatThreadCache';
import { createTurnContextSnapshot } from './turnContextSnapshot';
import { useConversationBranching } from './useConversationBranching';
import { startChatRunWatchdog } from './chatRunWatchdog';
import { useChatScopeActivity } from './useChatScopeActivity';
import { useChatMessageActions } from './useChatMessageActions';
import { useChatRunControls } from './useChatRunControls';
import { createMessageDeltaBatcher } from './createMessageDeltaBatcher';
import { markAgentMilestone } from './markAgentMilestone';
import { recoverChangedChatSession } from './recoverChangedChatSession';
import { useI18n } from '../../../i18n';
import {
  createChatConversationGuard,
  type ChatConversationMutationRef,
} from './chatConversationMutation';
import { useChatTurnLease } from './useChatTurnLease';
import { useChatMutationSenders } from './useChatMutationSenders';
import { chatScopeId } from '../chatScope';
import { useChatRunQueue } from './useChatRunQueue';

interface UseChatStreamOptions {
  agentScope: AgentScope;
  allWorkspaces?: WorkspaceOption[];
  modelLabel?: string;
  scopeLabel?: string;
  onActiveSessionChange?: (sessionId: string) => void;
  conversationSessionIdRef?: MutableRefObject<string | null>;
  conversationEpochRef?: MutableRefObject<number>;
  conversationMutationRef?: ChatConversationMutationRef;
}
export function useChatStream({
  agentScope,
  allWorkspaces,
  modelLabel,
  scopeLabel,
  onActiveSessionChange,
  conversationSessionIdRef,
  conversationEpochRef,
  conversationMutationRef,
}: UseChatStreamOptions) {
  const { t } = useI18n();
  const scopeKey = chatScopeId(agentScope);
  const [messages, setMessages] = useState<AgentChatMessage[]>(
    () => getCachedThread(scopeKey),
  );
  const [loading, setLoading] = useState(false);
  const [streamingTools, setStreamingTools] = useState<ToolCallStatus[]>([]);
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [messageTools, setMessageTools] = useState<Map<number, ToolCallStatus[]>>(new Map());
  const [collapsedSections, setCollapsedSections] = useState<Set<number>>(new Set());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [relay, setRelay] = useState<RelayProgress | null>(null);
  const [pendingClarify, setPendingClarify] = useState<PendingClarification | null>(null);
  const [clarifyInput, setClarifyInput] = useState('');
  const [clarificationAnswering, setClarificationAnswering] = useState(false);
  const [clarificationError, setClarificationError] = useState<string | null>(null);
  const toolIdCounter = useRef(0);
  const activeUnsubsRef = useRef<(() => void)[]>([]);
  const streamingMsgIdx = useRef(-1);
  const messagesRef = useRef(messages);
  const scopeEpochRef = useRef(0);
  messagesRef.current = messages;
  const resetTurnState = useCallback(() => {
    setLoading(false);
    setStreamingTools([]);
    setExpandedTools(new Set());
    setRelay(null);
    streamingMsgIdx.current = -1;
    setActiveSessionId(null);
    setPendingClarify(null);
    setClarifyInput('');
    setClarificationAnswering(false);
    setClarificationError(null);
  }, []);
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const previousScopeKeyRef = useRef(scopeKey);
  useLayoutEffect(() => {
    if (previousScopeKeyRef.current === scopeKey) return;
    scopeEpochRef.current += 1;
    cacheThread(previousScopeKeyRef.current, messagesRef.current);
    previousScopeKeyRef.current = scopeKey;
  }, [scopeKey]);
  useEffect(() => () => {
    scopeEpochRef.current += 1;
    cacheThread(previousScopeKeyRef.current, messagesRef.current);
  }, []);
  const replaceMessages = useCallback((nextMessages: AgentChatMessage[]) => {
    cacheThread(scopeKey, nextMessages);
    messagesRef.current = nextMessages;
    setMessages(nextMessages);
    setMessageTools(new Map(
      nextMessages.flatMap((message, index) => (
        message.role === 'assistant' && message.toolCalls?.length
          ? [[index, message.toolCalls]] as Array<[number, ToolCallStatus[]]>
          : []
      )),
    ));
    setCollapsedSections(new Set(
      nextMessages.flatMap((message, index) => (
        message.role === 'assistant' && message.toolCalls?.length ? [index] : []
      )),
    ));
    setExpandedTools(new Set());
    setStreamingTools([]);
  }, [scopeKey]);
  const handleRemoteRunState = useCallback((state: {
    active: boolean;
    sessionId?: string;
    pendingClarification?: PendingClarification;
  }) => {
    setLoading(state.active);
    setActiveSessionId(state.active ? state.sessionId ?? null : null);
    setPendingClarify(state.active ? state.pendingClarification ?? null : null);
    if (!state.active || !state.pendingClarification) {
      setClarifyInput('');
      setClarificationAnswering(false);
      setClarificationError(null);
    }
  }, []);
  const { busyElsewhere, claimScope, releaseScope, trackScopeRun } = useChatScopeActivity({
    scope: agentScope,
    scopeKey,
    onExternalRunComplete: replaceMessages,
    onRemoteRunState: handleRemoteRunState,
  });
  const finishActiveTurn = useCallback(() => { releaseScope(); resetTurnState(); }, [releaseScope, resetTurnState]);
  const { beginTurn, disposeCurrentTurn, retireCurrentTurn } = useChatTurnLease(finishActiveTurn);
  useEffect(() => {
    resetTurnState();
    return disposeCurrentTurn;
  }, [resetTurnState, disposeCurrentTurn, scopeKey]);
  const { addImageToCanvas, appendTurnFailure, applyResolvedModel } = useChatMessageActions(workspaceId, setMessages);
  const sendMessageInternal = useCallback(async (
    rawText: string,
    requestContext?: AgentRequestContext,
    attachments: ChatImageAttachment[] = [],
    attempt?: { started: boolean },
  ) => {
    const text = rawText.trim();
    if (
      (!text && attachments.length === 0)
      || loading
      || busyElsewhere
    ) return false;
    const turn = beginTurn();
    if (!turn || !claimScope()) {
      turn?.retire();
      return false;
    }
    if (attempt) attempt.started = true;
    const { isCurrent, guard } = createChatConversationGuard(
      scopeEpochRef, conversationEpochRef, conversationMutationRef, turn.isCurrent,
    );
    const messagesBeforeTurn = messagesRef.current;
    turn.registerSuperseded(() => replaceMessages(messagesBeforeTurn));
    const contextSnapshot = createTurnContextSnapshot(agentScope, requestContext, {
      modelLabel: modelLabel ?? t('models.auto'),
      scopeLabel: scopeLabel ?? (agentScope.kind === 'global' ? t('chat.scope.global') : agentScope.kind === 'scheduled' ? t('chat.scope.scheduled') : agentScope.workspaceId),
    });
    const persistedRequestContext: AgentRequestContext = {
      ...requestContext,
      expectedConversationSessionId: conversationSessionIdRef?.current,
      contextSnapshot,
    };
    const userMessage: AgentChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
      contextSnapshot,
    };
    setMessages(prev => [...prev, userMessage]);
    setLoading(true);
    try {
      const mentionedWorkspaceIds = workspaceId
        ? extractMentionedWorkspaceIds(text, allWorkspaces, workspaceId)
        : extractMentionedWorkspaceIds(text, allWorkspaces, '');
      const result = await window.canvasWorkspace.agent.prepareChat(
        { scope: agentScope },
        text,
        mentionedWorkspaceIds.length > 0 ? mentionedWorkspaceIds : undefined,
        persistedRequestContext,
        attachments.length > 0 ? attachments : undefined,
      );
      if (!result.ok || !result.sessionId) {
        if (isCurrent()) appendTurnFailure(result.error ?? t('chat.turn.startFailed'));
        turn.retire();
        return false;
      }
      const sessionId = result.sessionId;
      markAgentMilestone(sessionId, 'ui.request-dispatched', userMessage.timestamp);
      if (!isCurrent()) {
        await window.canvasWorkspace.agent.cancelPreparedChat(sessionId).catch(() => undefined);
        turn.retire();
        return false;
      }
      const segment = createSegmentState();
      setActiveSessionId(sessionId);
      let turnClosed = false;
      let turnCompleted = false;
      let cancelWatchdog: () => void = () => undefined;
      let turnUnsubs: Array<() => void> = [];
      const ensureAssistantMessage = () => {
        if (segment.msgIndex >= 0) return;
        setMessages(prev => {
          if (segment.msgIndex >= 0) return prev;
          segment.msgIndex = prev.length;
          streamingMsgIdx.current = prev.length;
          return [...prev, { role: 'assistant', content: '', timestamp: Date.now() }];
        });
      };
      const cleanupTurn = () => {
        if (turnClosed) return;
        turnClosed = true;
        cancelWatchdog();
        for (const unsubscribe of turnUnsubs) unsubscribe();
        activeUnsubsRef.current = activeUnsubsRef.current.filter(
          unsubscribe => !turnUnsubs.includes(unsubscribe),
        );
      };
      turn.registerCleanup(cleanupTurn);
      const publishTools = () => {
        const snapshot = [...segment.tools];
        setStreamingTools(snapshot);
        if (segment.msgIndex >= 0) {
          setMessageTools(prev => new Map(prev).set(segment.msgIndex, snapshot));
        }
      };
      const textDeltaBatcher = createMessageDeltaBatcher({ segment, setMessages, isCurrent,
        onFirstCommit: () => window.requestAnimationFrame(() =>
          markAgentMilestone(sessionId, 'ui.first-content-rendered')),
      });
      const findTool = (toolCallId: string | undefined, name?: string) => {
        if (toolCallId) {
          const byId = segment.tools.find(t => t.toolCallId === toolCallId);
          if (byId) return byId;
        }
        if (name) {
          return segment.tools.find(t => t.name === name && t.status === 'running');
        }
        return undefined;
      };
      const unsubscribeToolInputStart = window.canvasWorkspace.agent.onToolInputStart(sessionId, guard(data => {
        ensureAssistantMessage();
        upsertToolInputStart(segment.tools, data, () => ++toolIdCounter.current);
        publishTools();
      }));
      const unsubscribeToolInputDelta = window.canvasWorkspace.agent.onToolInputDelta(sessionId, guard(data => {
        const tool = findTool(data.id);
        if (!tool) return;
        tool.partialInput = (tool.partialInput ?? '') + data.delta;
        publishTools();
      }));

      const unsubscribeToolInputEnd = window.canvasWorkspace.agent.onToolInputEnd(sessionId, guard(data => {
        const tool = findTool(data.id);
        if (!tool) return;
        tool.inputStreaming = false;
        publishTools();
      }));

      const unsubscribeVisualStream = subscribeVisualStream({
        workspaceId,
        findTool: (...args) => isCurrent() ? findTool(...args) : undefined,
        publishTools: guard(publishTools),
      });

      const unsubscribeToolCall = window.canvasWorkspace.agent.onToolCall(sessionId, guard(data => {
        ensureAssistantMessage();
        const existing = findTool(data.toolCallId, data.name);
        if (existing) {
          existing.args = data.args;
          existing.inputStreaming = false;
        } else {
          segment.tools.push({
            id: ++toolIdCounter.current,
            name: data.name,
            args: data.args,
            toolCallId: data.toolCallId,
            status: 'running',
          });
        }
        publishTools();
      }));

      const unsubscribeToolResult = window.canvasWorkspace.agent.onToolResult(sessionId, guard(data => {
        markToolResult(segment.tools, data);
        publishTools();
      }));

      const unsubscribeDelta = window.canvasWorkspace.agent.onTextDelta(sessionId, guard(delta => {
        ensureAssistantMessage();
        count('chat-stream-delta');
        textDeltaBatcher.push(delta);
      }));

      const unsubscribeClarify = window.canvasWorkspace.agent.onClarifyRequest(sessionId, guard(request => {
        ensureAssistantMessage();
        setPendingClarify(request);
        setClarifyInput('');
        setClarificationError(null);
      }));

      const segmentHandlers = createRelayTurnHandlers({
        segment, unresolvedToolError: t('chat.toolCalls.noResult'),
        streamingMsgIdx,
        flushDeltas: () => textDeltaBatcher.flush(),
        setMessages,
        setMessageTools,
        setCollapsedSections,
        setStreamingTools,
        setRelay,
      });
      const unsubscribeRoleTurnStart = window.canvasWorkspace.agent.onRoleTurnStart(
        sessionId, guard(segmentHandlers.handleRoleTurnStart),
      );
      const unsubscribeRoleTurnEnd = window.canvasWorkspace.agent.onRoleTurnEnd(
        sessionId, guard(segmentHandlers.handleRoleTurnEnd),
      );

      const unsubscribeComplete = window.canvasWorkspace.agent.onChatComplete(sessionId, guard(completeResult => {
        if (turnClosed) return;
        turnCompleted = true;
        textDeltaBatcher.flush();
        cleanupTurn();
        if (completeResult.code === 'CHAT_SESSION_CHANGED') {
          releaseScope();
          void recoverChangedChatSession({
            scope: agentScope, isCurrent, replaceMessages,
            adoptSession: onActiveSessionChange,
            appendFailure: appendTurnFailure,
            reset: () => turn.retire(),
            error: completeResult.error ?? t('chat.sessionChanged'),
          });
          return;
        }
        settleRunningTools(
          segment.tools,
          completeResult.stopped ? 'cancelled' : 'failed',
          completeResult.stopped ? t('chat.toolCalls.cancelled') : t('chat.toolCalls.noResult'),
        );
        const toolSnapshot = segment.tools.length > 0 ? segment.tools.map(tool => ({ ...tool })) : undefined;
        if (segment.msgIndex >= 0 && toolSnapshot) {
          setCollapsedSections(prev => {
            const next = new Set(prev);
            if (toolSnapshot.some(tool => tool.status === 'failed' || tool.status === 'cancelled')) {
              next.delete(segment.msgIndex);
            } else {
              next.add(segment.msgIndex);
            }
            return next;
          });
        }

        applyTurnCompletion({ completeResult, segment, toolSnapshot, setMessages, failureFallback: t('chat.turn.failure.unknown') });
        turn.retire();
      }));

      turnUnsubs = [
        unsubscribeToolCall,
        unsubscribeToolResult,
        unsubscribeToolInputStart,
        unsubscribeToolInputDelta,
        unsubscribeToolInputEnd,
        unsubscribeVisualStream,
        unsubscribeDelta,
        unsubscribeComplete,
        unsubscribeClarify,
        unsubscribeRoleTurnStart,
        unsubscribeRoleTurnEnd,
        textDeltaBatcher.cancel,
        () => cancelWatchdog(),
      ];
      activeUnsubsRef.current.push(...turnUnsubs);

      const startResult = await window.canvasWorkspace.agent.startChat(sessionId);
      if (turnCompleted) return true;
      if (!isCurrent()) {
        turn.retire();
        return false;
      }
      if (!startResult.ok) {
        appendTurnFailure(startResult.error ?? t('chat.turn.startFailed'));
        turn.retire();
        return false;
      }
      applyResolvedModel(userMessage.timestamp, {
        modelProvider: startResult.modelProvider,
        modelId: startResult.modelId,
        modelLabel: startResult.modelLabel ?? contextSnapshot.modelLabel,
      });
      trackScopeRun(sessionId);
      if (!turnClosed) {
        cancelWatchdog = startChatRunWatchdog({
          getRunStatus: () => window.canvasWorkspace.agent.getRunStatus(sessionId),
          recoverHistory: () => window.canvasWorkspace.agent.getHistory({ scope: agentScope }),
          onRecovered: guard((historyMessages) => {
            replaceMessages(historyMessages);
            turn.retire();
          }),
          onRecoveryFailed: guard((error) => {
            appendTurnFailure(error);
            turn.retire();
          }),
        });
      }
      return true;
    } catch (error) {
      if (isCurrent()) appendTurnFailure(error);
      turn.retire();
      return false;
    }
  }, [
    agentScope,
    allWorkspaces,
    applyResolvedModel,
    appendTurnFailure,
    busyElsewhere,
    beginTurn,
    claimScope,
    conversationSessionIdRef,
    conversationEpochRef, conversationMutationRef,
    loading,
    modelLabel,
    onActiveSessionChange,
    replaceMessages,
    releaseScope,
    scopeLabel, t,
    trackScopeRun,
    workspaceId,
  ]);
  const { sendMessage, sendMessageForMutation } = useChatMutationSenders(sendMessageInternal, conversationMutationRef);
  const { abort, stopRelay } = useChatRunControls({
    activeSessionId,
    setRelay,
    setPendingClarify,
    setClarifyInput,
  });
  const sendQueuedMessage = useCallback(async (text: string, context?: AgentRequestContext) => {
    if (conversationMutationRef?.current.busy) return 'blocked' as const;
    const attempt = { started: false };
    const accepted = await sendMessageInternal(text, context, [], attempt);
    return accepted ? 'accepted' as const : attempt.started ? 'failed' as const : 'blocked' as const;
  }, [conversationMutationRef, sendMessageInternal]);
  const getConversationSessionId = useCallback(() => conversationSessionIdRef?.current, [conversationSessionIdRef]);
  const runQueue = useChatRunQueue({
    scopeKey, loading, busyElsewhere, abort, getConversationSessionId,
    sendMessage: sendQueuedMessage,
  });
  const answerClarification = useCallback(async (answerOverride?: string) => {
    const pending = pendingClarify;
    const sessionId = activeSessionId;
    if (!pending || !sessionId) return;
    const answer = (answerOverride ?? clarifyInput).trim();
    if (!answer) return;

    setClarificationError(null);
    setClarificationAnswering(true);
    try {
      const result = await window.canvasWorkspace.agent.answerClarification(sessionId, pending.id, answer);
      if (!result.ok) {
        setClarificationError(result.error ?? t('chat.clarificationDeliveryFailed'));
        return;
      }
      setPendingClarify(current => current?.id === pending.id ? null : current);
      setClarifyInput('');
    } catch (error) {
      setClarificationError(error instanceof Error ? error.message : String(error));
    } finally {
      setClarificationAnswering(false);
    }
  }, [activeSessionId, clarifyInput, pendingClarify, t]);
  const branching = useConversationBranching({
    agentScope,
    loading,
    messages,
    replaceMessages,
    sendMessageForMutation,
    onActiveSessionChange,
    onConversationMutationStart: retireCurrentTurn,
    conversationEpochRef, conversationMutationRef,
  });
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

  return {
    abort: runQueue.abortAndClearQueue,
    relay,
    stopRelay,
    addImageToCanvas,
    answerClarification,
    busyElsewhere,
    clarifyInput,
    clarificationAnswering,
    clarificationError,
    conversationError: branching.conversationError,
    collapsedSections,
    editUserMessage: branching.editUserMessage,
    expandedTools,
    loading,
    messageTools,
    messages,
    pendingClarify,
    regenerateAssistantMessage: branching.regenerateAssistantMessage,
    replaceMessages,
    retireCurrentTurn,
    sendMessage,
    runQueue,
    submitRunInput: runQueue.submitRunInput,
    setClarifyInput,
    streamingTools,
    toggleSection,
    toggleToolExpand,
  };
}
