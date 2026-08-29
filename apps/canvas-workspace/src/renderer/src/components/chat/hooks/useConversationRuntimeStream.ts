import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentChatMessage, AgentRequestContext, ChatImageAttachment } from '../../../types';
import type { AgentScope, PendingClarification, ToolCallStatus, WorkspaceOption } from '../types';
import type { ConversationKey } from '../../../../../shared/conversation-runtime';
import {
  appendConversationTextAt,
  pushConversationMessage,
  readConversationSnapshot,
  setConversationClarification,
  setConversationError,
  setConversationLoading,
  setConversationMessages,
  setConversationStreamingTools,
  useConversationSnapshot,
} from './conversationStore';
import { extractMentionedWorkspaceIds } from '../utils/mentions';
import { markAgentMilestone } from './markAgentMilestone';
import { count } from '../../../perf/counters';
import { useChatRunQueue } from './useChatRunQueue';
import type { RelayProgress } from './relayTurnHandlers';
import { createConversationTextBatcher } from './conversationTextBatcher';
import { friendlyChatFailure } from './chatTurnOutcome';
import { clearConversationCompletion, recordConversationCompletion, useConversationVisibility } from './conversationCompletionStore';

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

const toPending = (c: { id: string; question: string; context?: string; kind?: string; defaultAnswer?: string } | null): PendingClarification | null =>
  c ? { id: c.id, question: c.question, context: c.context, kind: c.kind as PendingClarification['kind'], defaultAnswer: c.defaultAnswer } : null;

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
  useConversationVisibility(key, keyed && visible);

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
  ): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed && attachments.length === 0) return false;
    if (!keyed) return false;
    if (readConversationSnapshot(key).status === 'running') return false;

    const userMessage: AgentChatMessage = {
      role: 'user',
      content: trimmed,
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? attachments : undefined,
    };
    pushConversationMessage(key, userMessage);
    clearConversationCompletion(key);
    setConversationLoading(key, true);
    setConversationError(key, null);

    const mentionedWorkspaceIds = workspaceId
      ? extractMentionedWorkspaceIds(trimmed, allWorkspaces, workspaceId)
      : extractMentionedWorkspaceIds(trimmed, allWorkspaces, '');

    // stream events are keyed by the conversation's own sessionId (no separate
    // prepared run id), so listeners install BEFORE starting.
    const sessionId = key.sessionId;
    markAgentMilestone(sessionId, 'ui.request-dispatched', userMessage.timestamp);
    let unsubs: Array<() => void> = [];
    const cleanupRunListeners = () => {
      const active = unsubs;
      unsubs = [];
      active.forEach(unsubscribe => unsubscribe());
    };

    try {
      let assistantIndex = -1;
      let assistantText = '';
      const segmentTools: ToolCallStatus[] = [];
      let settled = false;
      const ensureAssistant = () => {
        if (assistantIndex >= 0) return;
        const current = readConversationSnapshot(key).messages;
        assistantIndex = current.length;
        setConversationMessages(key, [...current, { role: 'assistant', content: '', timestamp: Date.now() }]);
      };

      const publishTools = () => {
        setConversationStreamingTools(key, [...segmentTools]);
        if (assistantIndex >= 0) {
          setMessageTools(prev => new Map(prev).set(assistantIndex, [...segmentTools]));
        }
      };

      const flushAssistantText = (delta: string) => {
        if (assistantIndex < 0) return;
        if (!appendConversationTextAt(key, assistantIndex, delta)) {
          assistantIndex = -1;
          ensureAssistant();
          appendConversationTextAt(key, assistantIndex, delta);
        }
        count('chat-stream-commit');
      };
      const textBatcher = createConversationTextBatcher(flushAssistantText);

      unsubs = [
        window.canvasWorkspace.agent.onTextDelta(sessionId, delta => {
          ensureAssistant();
          count('chat-stream-delta');
          assistantText += delta;
          textBatcher.push(delta);
        }),
        window.canvasWorkspace.agent.onToolCall(sessionId, data => {
          ensureAssistant();
          const existing = data.toolCallId
            ? segmentTools.find(t => t.toolCallId === data.toolCallId)
            : undefined;
          if (existing) {
            existing.args = data.args;
            existing.inputStreaming = false;
          } else {
            segmentTools.push({
              id: ++toolIdCounter.current,
              name: data.name,
              args: data.args,
              toolCallId: data.toolCallId,
              status: 'running', startedAt: Date.now(),
            });
          }
          publishTools();
        }),
        window.canvasWorkspace.agent.onToolResult(sessionId, data => {
          const tool = data.toolCallId
            ? segmentTools.find(t => t.toolCallId === data.toolCallId)
            : segmentTools.find(t => t.name === data.name && t.status === 'running');
          if (tool) {
            tool.status = data.status ?? 'succeeded';
            tool.result = data.result;
            tool.error = data.error;
            tool.inputStreaming = false; tool.finishedAt = Date.now();
          }
          publishTools();
        }),
        window.canvasWorkspace.agent.onToolInputStart(sessionId, data => {
          const existing = data.id
            ? segmentTools.find(t => t.toolCallId === data.id)
            : undefined;
          if (existing) {
            existing.name = data.toolName;
            if (existing.status === 'running') existing.inputStreaming = true;
          } else {
            segmentTools.push({
              id: ++toolIdCounter.current,
              name: data.toolName,
              toolCallId: data.id,
              status: 'running', startedAt: Date.now(),
              partialInput: '',
              inputStreaming: true,
            });
          }
          publishTools();
        }),
        window.canvasWorkspace.agent.onToolInputDelta(sessionId, data => {
          const tool = data.id
            ? segmentTools.find(t => t.toolCallId === data.id)
            : undefined;
          if (tool) tool.partialInput = (tool.partialInput ?? '') + data.delta;
          publishTools();
        }),
        window.canvasWorkspace.agent.onToolInputEnd(sessionId, data => {
          const tool = data.id
            ? segmentTools.find(t => t.toolCallId === data.id)
            : undefined;
          if (tool) tool.inputStreaming = false;
          publishTools();
        }),
        window.canvasWorkspace.agent.onClarifyRequest(sessionId, request => {
          ensureAssistant();
          setConversationClarification(key, request);
        }),
        window.canvasWorkspace.agent.onChatComplete(sessionId, completeResult => {
          if (settled) return;
          settled = true;
          if (completeResult.code === 'CHAT_SESSION_CHANGED') {
            const error = completeResult.error ?? 'Conversation changed';
            setConversationError(key, error);
            setConversationLoading(key, false);
            recordConversationCompletion(key, 'failed', completeResult.runId ?? `${key.storeId}:${sessionId}:${userMessage.timestamp}`, trimmed.slice(0, 60));
            cleanupRunListeners();
            void onSessionChangedRef.current?.(error);
            return;
          }
          textBatcher.flush();
          // Settle unfinished tools.
          for (const tool of segmentTools) {
            if (tool.status === 'running' || tool.status === 'queued') {
              tool.status = completeResult.stopped ? 'cancelled' : 'failed';
              tool.error = completeResult.stopped ? 'cancelled' : 'no result'; tool.finishedAt = Date.now();
            }
          }
          const current = readConversationSnapshot(key).messages;
          const target = current[assistantIndex];
          const finalContent = completeResult.stopped || !completeResult.ok
            ? assistantText || completeResult.response || target?.content || ''
            : completeResult.response || assistantText || target?.content || '';
          const turnStatus = completeResult.stopped
            ? 'stopped' as const
            : !completeResult.ok ? 'failed' as const : undefined;
          const failure = !completeResult.ok
            ? friendlyChatFailure(completeResult.error ?? '')
            : undefined;
          const roleMetadata = completeResult.speakerRole ? {
            speakerRoleId: completeResult.speakerRole.id,
            speakerRoleName: completeResult.speakerRole.name,
            speakerRoleColor: completeResult.speakerRole.color,
          } : {};
          if (target?.role === 'assistant') {
            const finalAssistant: AgentChatMessage = {
              ...target,
              content: finalContent,
              toolCalls: segmentTools.length > 0 ? segmentTools : undefined,
              turnStatus,
              errorDetails: failure?.details,
              failureKind: failure?.kind,
              retryable: completeResult.stopped ? true : failure?.retryable,
              runId: completeResult.runId,
              ...roleMetadata,
            };
            current[assistantIndex] = finalAssistant;
          } else {
            assistantIndex = current.length;
            current.push({
              role: 'assistant',
              content: finalContent,
              timestamp: Date.now(),
              toolCalls: segmentTools.length > 0 ? segmentTools : undefined,
              turnStatus,
              errorDetails: failure?.details,
              failureKind: failure?.kind,
              retryable: completeResult.stopped ? true : failure?.retryable,
              runId: completeResult.runId,
              ...roleMetadata,
            });
          }
          setConversationMessages(key, current);
          setConversationLoading(key, false);
          setConversationStreamingTools(key, []);
          setConversationClarification(key, null);
          setRelay(null);
          recordConversationCompletion(key, completeResult.stopped ? 'stopped' : completeResult.ok ? 'done' : 'failed', completeResult.runId ?? `${key.storeId}:${sessionId}:${userMessage.timestamp}`, trimmed.slice(0, 60));
          if (!completeResult.ok && completeResult.error) {
            setConversationError(key, completeResult.error);
          }
          onTurnCompleteRef.current?.();
          cleanupRunListeners();
        }),
        window.canvasWorkspace.agent.onRoleTurnStart(sessionId, event => {
          setRelay({
            speaking: event.index,
            total: event.total,
            queue: event.queue ?? [],
          });
        }),
        window.canvasWorkspace.agent.onRoleTurnEnd(sessionId, event => {
          setRelay(current => current ? {
            ...current,
            speaking: Math.max(current.speaking, event.index + 1),
          } : current);
        }),
      ];

      const started = await window.canvasWorkspace.agent.conversationChat(
        agentScope,
        key.sessionId,
        trimmed,
        mentionedWorkspaceIds,
        { ...requestContext, expectedConversationSessionId: key.sessionId },
        attachments,
      );
      if (!started.ok) {
        setConversationError(key, started.error ?? 'Chat turn failed to start');
        setConversationLoading(key, false);
        cleanupRunListeners();
        return false;
      }
      return true;
    } catch (error) {
      cleanupRunListeners();
      setConversationError(key, error instanceof Error ? error.message : String(error));
      setConversationLoading(key, false);
      return false;
    }
  }, [agentScope, allWorkspaces, key, keyed, snapshot.status, workspaceId]);

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
  // wrappers over the same IPC the legacy hook uses; the turn lease / scope
  // owner / reattach / replay compensation chains are NOT needed here because
  // the conversation owns its state and switching is just a selector.
  const [relay, setRelay] = useState<RelayProgress | null>(null);
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

  const editUserMessage = useCallback(async (
    index: number,
    newContent: string,
    requestContext?: AgentRequestContext,
  ): Promise<boolean> => {
    const result = await window.canvasWorkspace.agent.branchSession({ scope: agentScope }, index);
    if (!result.ok || !result.messages) return false;
    setConversationMessages(key, result.messages as AgentChatMessage[]);
    if (newContent.trim()) {
      await sendMessage(newContent.trim(), requestContext);
    }
    return true;
  }, [agentScope, key, sendMessage]);

  const regenerateAssistantMessage = useCallback(async (
    index: number,
    requestContext?: AgentRequestContext,
  ): Promise<boolean> => {
    const source = snapshot.messages[index];
    const result = await window.canvasWorkspace.agent.branchSession({ scope: agentScope }, index);
    if (!result.ok || !result.messages) return false;
    setConversationMessages(key, result.messages as AgentChatMessage[]);
    if (source?.role === 'user' && source.content.trim()) {
      await sendMessage(source.content.trim(), requestContext);
    }
    return true;
  }, [agentScope, key, sendMessage, snapshot.messages]);

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

/** Build a conversation key from a scope + session id (thin helper). */
export const conversationKeyFromScope = (
  scope: AgentScope,
  sessionId: string,
): ConversationKey => ({
  storeId: scope.kind === 'workspace'
    ? scope.workspaceId
    : scope.kind === 'scheduled'
      ? `__scheduled__-${scope.taskId}`
      : '__global_chat__',
  sessionId,
});
