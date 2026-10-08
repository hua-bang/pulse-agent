import { contentText, finishContentBlocks } from '../../../../../shared/chat-content-blocks';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type {
  AgentChatMessage,
  AgentScope,
  RelayProgress,
  ToolCallStatus,
} from '../../../types';
import {
  CHAT_RECOVERY_REJECTED,
  conversationKeyId,
  type ConversationKey,
} from '../../../../../shared/conversation-runtime';
import {
  appendConversationTextAt,
  appendConversationToolsAt,
  readConversationSnapshot,
  setConversationClarification,
  setConversationError,
  setConversationLoading,
  setConversationMessages,
  setConversationStreamingTools,
} from './conversationStore';
import { count } from '../../../perf/counters';
import { createConversationTextBatcher } from './conversationTextBatcher';
import { friendlyChatFailure, settleStreamTools } from './chatTurnOutcome';
import { recordConversationCompletion } from './conversationCompletionStore';

/** Surface state a turn observer updates besides the shared conversation store. */
export interface TurnObserverHooks {
  toolIdCounter: MutableRefObject<number>;
  setMessageTools: Dispatch<SetStateAction<Map<number, ToolCallStatus[]>>>;
  setRelay: Dispatch<SetStateAction<RelayProgress | null>>;
  onTurnComplete?: () => void;
  onSessionChanged?: (error: string) => void | Promise<void>;
}

interface TurnObserverOptions {
  key: ConversationKey;
  /** Renderer trace id of a turn sent from this surface. */
  runId?: string;
  /** First user text, used for background completion notices. */
  title: string;
  completionId: string;
  /** Edit/regenerate: restore the thread when main refuses the replacement. */
  restoreRecovery?: () => void;
  /** Ignore events until `resume`, used while an attach snapshot is in flight. */
  paused?: boolean;
}

interface ResumeState {
  assistantIndex: number;
  assistantText: string;
  tools: ToolCallStatus[];
}

export interface TurnObserver {
  resume: (state?: ResumeState) => void;
  dispose: () => void;
}

/** Conversations whose current turn already has a stream observer in this renderer. */
const observed = new Set<string>();

/**
 * Apply one turn's stream events to the conversation store, from the first
 * event to `chat-complete`. Sent turns start live; an attach starts paused,
 * then resumes from main's snapshot of the reply so far.
 */
export function observeConversationTurn(options: TurnObserverOptions, hooks: TurnObserverHooks): TurnObserver {
  const { key, runId } = options;
  const sessionId = key.sessionId;
  const id = conversationKeyId(key);
  const agent = window.canvasWorkspace.agent;
  observed.add(id);

  let paused = options.paused ?? false;
  let assistantIndex = -1;
  let assistantText = '';
  let segmentTools: ToolCallStatus[] = [];
  let settled = false;
  let unsubs: Array<() => void> = [];
  const dispose = () => {
    const active = unsubs;
    unsubs = [];
    active.forEach(unsubscribe => unsubscribe());
    observed.delete(id);
  };

  const ensureAssistant = () => {
    if (assistantIndex >= 0) return;
    const current = readConversationSnapshot(key).messages;
    assistantIndex = current.length;
    setConversationMessages(key, [...current, { role: 'assistant', content: '', contentBlocks: [], timestamp: Date.now(), runId }]);
  };

  const publishTools = () => {
    appendConversationToolsAt(key, assistantIndex, segmentTools);
    setConversationStreamingTools(key, [...segmentTools]);
    if (assistantIndex >= 0) {
      const index = assistantIndex;
      hooks.setMessageTools(prev => new Map(prev).set(index, [...segmentTools]));
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
  const live = <T,>(handler: (payload: T) => void) => (payload: T) => {
    if (!paused) handler(payload);
  };

  const complete = (completeResult: Parameters<Parameters<typeof agent.onChatComplete>[1]>[0]) => {
    if (settled) return;
    settled = true;
    if (completeResult.code === CHAT_RECOVERY_REJECTED) options.restoreRecovery?.();
    if (completeResult.code === CHAT_RECOVERY_REJECTED || completeResult.code === 'CHAT_SESSION_CHANGED') {
      const error = completeResult.error ?? 'Conversation changed';
      setConversationError(key, error);
      setConversationLoading(key, false);
      recordConversationCompletion(key, 'failed', completeResult.runId ?? options.completionId, options.title);
      dispose();
      if (completeResult.code === 'CHAT_SESSION_CHANGED') void hooks.onSessionChanged?.(error);
      return;
    }
    textBatcher.flush();
    settleStreamTools(segmentTools, completeResult.stopped);
    const current = readConversationSnapshot(key).messages;
    const target = current[assistantIndex];
    const finalContent = completeResult.stopped || !completeResult.ok
      ? assistantText || completeResult.response || target?.content || ''
      : completeResult.response || assistantText || target?.content || '';
    const contentBlocks = finishContentBlocks(target?.contentBlocks ?? [], finalContent);
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
    const finalAssistant: AgentChatMessage = {
      ...(target?.role === 'assistant' ? target : {}),
      role: 'assistant',
      timestamp: target?.timestamp ?? Date.now(),
      content: contentText(contentBlocks),
      contentBlocks,
      toolCalls: segmentTools.length > 0 ? segmentTools : undefined,
      turnStatus,
      errorDetails: failure?.details,
      failureKind: failure?.kind,
      retryable: completeResult.stopped ? true : failure?.retryable,
      runId: completeResult.runId,
      ...roleMetadata,
    };
    if (target?.role === 'assistant') current[assistantIndex] = finalAssistant;
    else {
      assistantIndex = current.length;
      current.push(finalAssistant);
    }
    if (completeResult.assistantMessages?.length) {
      const firstIndex = assistantIndex;
      current.splice(firstIndex, 1, ...completeResult.assistantMessages);
      hooks.setMessageTools(previous => {
        const next = new Map(previous);
        completeResult.assistantMessages!.forEach((message, offset) => {
          next.set(firstIndex + offset, message.toolCalls ?? []);
        });
        return next;
      });
    }
    setConversationMessages(key, current);
    setConversationLoading(key, false);
    setConversationStreamingTools(key, []);
    setConversationClarification(key, null);
    hooks.setRelay(null);
    recordConversationCompletion(
      key,
      completeResult.stopped ? 'stopped' : completeResult.ok ? 'done' : 'failed',
      completeResult.runId ?? options.completionId,
      options.title,
    );
    // The failed assistant message already shows the outcome, its
    // diagnostics and retry. A conversation-level banner would repeat
    // the raw error and, unlike the message, would not survive reload.
    hooks.onTurnComplete?.();
    dispose();
  };

  unsubs = [
    agent.onTextDelta(sessionId, live(delta => {
      ensureAssistant();
      count('chat-stream-delta');
      assistantText += delta;
      textBatcher.push(delta);
    })),
    agent.onToolCall(sessionId, live(data => {
      textBatcher.flush();
      ensureAssistant();
      const existing = data.toolCallId
        ? segmentTools.find(t => t.toolCallId === data.toolCallId)
        : undefined;
      if (existing) {
        existing.args = data.args;
        existing.inputStreaming = false;
      } else {
        segmentTools.push({
          id: ++hooks.toolIdCounter.current,
          name: data.name,
          args: data.args,
          toolCallId: data.toolCallId,
          status: 'running', startedAt: Date.now(),
        });
      }
      publishTools();
    })),
    agent.onToolResult(sessionId, live(data => {
      const tool = data.toolCallId
        ? segmentTools.find(t => t.toolCallId === data.toolCallId)
        : segmentTools.find(t => t.name === data.name && t.status === 'running');
      if (tool) {
        tool.status = data.status ?? 'succeeded';
        tool.result = data.result;
        tool.error = data.error; tool.mcpApp = data.mcpApp;
        tool.inputStreaming = false; tool.finishedAt = Date.now();
      }
      publishTools();
    })),
    agent.onToolInputStart(sessionId, live(data => {
      textBatcher.flush();
      ensureAssistant();
      const existing = data.id
        ? segmentTools.find(t => t.toolCallId === data.id)
        : undefined;
      if (existing) {
        existing.name = data.toolName;
        if (existing.status === 'running') existing.inputStreaming = true;
      } else {
        segmentTools.push({
          id: ++hooks.toolIdCounter.current,
          name: data.toolName,
          toolCallId: data.id,
          status: 'running', startedAt: Date.now(),
          partialInput: '',
          inputStreaming: true,
        });
      }
      publishTools();
    })),
    agent.onToolInputDelta(sessionId, live(data => {
      const tool = data.id
        ? segmentTools.find(t => t.toolCallId === data.id)
        : undefined;
      if (tool) tool.partialInput = (tool.partialInput ?? '') + data.delta;
      publishTools();
    })),
    agent.onToolInputEnd(sessionId, live(data => {
      const tool = data.id
        ? segmentTools.find(t => t.toolCallId === data.id)
        : undefined;
      if (tool) tool.inputStreaming = false;
      publishTools();
    })),
    agent.onClarifyRequest(sessionId, live(request => {
      ensureAssistant();
      setConversationClarification(key, request);
    })),
    agent.onChatComplete(sessionId, live(complete)),
    agent.onRoleTurnStart(sessionId, live(event => {
      hooks.setRelay({
        speaking: event.index,
        total: event.total,
        queue: event.queue ?? [],
      });
    })),
    agent.onRoleTurnEnd(sessionId, live(event => {
      hooks.setRelay(current => current ? {
        ...current,
        speaking: Math.max(current.speaking, event.index + 1),
      } : current);
    })),
  ];

  return {
    resume: (state) => {
      if (state) {
        assistantIndex = state.assistantIndex;
        assistantText = state.assistantText;
        segmentTools = state.tools;
        hooks.toolIdCounter.current = Math.max(hooks.toolIdCounter.current, ...state.tools.map(tool => tool.id));
      }
      paused = false;
    },
    dispose,
  };
}

const attaching = new Set<string>();

/**
 * Reconnect this renderer to a conversation whose turn is still running in
 * main, after the surface lost its stream (renderer reload, another window).
 * Events that arrive before main's reply are already in its snapshot, so the
 * observer stays paused until the snapshot is applied.
 */
export async function attachConversationTurn(
  scope: AgentScope,
  key: ConversationKey,
  hooks: TurnObserverHooks,
): Promise<boolean> {
  const id = conversationKeyId(key);
  const agent = typeof window === 'undefined' ? undefined : window.canvasWorkspace?.agent;
  // Surfaces without the preload bridge (UI showcase, partial test hosts) have nothing to attach to.
  if (typeof agent?.conversationAttach !== 'function') return false;
  if (observed.has(id) || attaching.has(id) || readConversationSnapshot(key).status === 'running') return false;
  attaching.add(id);
  let observer: TurnObserver | null = null;
  try {
    const firstUser = readConversationSnapshot(key).messages.find(message => message.role === 'user');
    observer = observeConversationTurn({
      key,
      title: firstUser?.content.slice(0, 60) ?? '',
      completionId: `${key.storeId}:${key.sessionId}:attach:${Date.now()}`,
      paused: true,
    }, hooks);
    const result = await agent.conversationAttach(scope, key.sessionId);
    const snapshot = result.ok && result.running ? result.snapshot : undefined;
    if (!snapshot || readConversationSnapshot(key).status === 'running') {
      observer.dispose();
      return false;
    }
    const draft = snapshot.draft ?? null;
    setConversationMessages(key, draft ? [...snapshot.messages, draft] : snapshot.messages);
    setConversationStreamingTools(key, snapshot.streamingTools);
    setConversationClarification(key, snapshot.clarification);
    setConversationError(key, null);
    setConversationLoading(key, true);
    observer.resume({
      assistantIndex: draft ? snapshot.messages.length : -1,
      assistantText: draft?.content ?? '',
      tools: snapshot.streamingTools.map(tool => ({ ...tool })),
    });
    return true;
  } catch {
    observer?.dispose();
    return false;
  } finally {
    attaching.delete(id);
  }
}
