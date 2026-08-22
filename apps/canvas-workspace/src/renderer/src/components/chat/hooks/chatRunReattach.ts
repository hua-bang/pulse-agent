import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { AgentChatMessage, AgentClarificationRequest, AgentChatToolCall } from '../../../types';
import type { PendingClarification, ToolCallStatus } from '../types';
import { createSegmentState, type SegmentState } from './relayTurnHandlers';
import { createMessageDeltaBatcher } from './createMessageDeltaBatcher';
import { markToolResult, settleRunningTools, upsertToolInputStart } from './toolStreamState';

/**
 * Re-attach a chat surface to an ALREADY-RUNNING conversation stream. Used
 * when the user switches back to a session whose run is still in flight
 * (started before they left, or by another surface): instead of showing
 * "Another chat view is generating", subscribe to the run's live events and
 * keep appending to the thread that `getHistory` just restored.
 *
 * This is a deliberately lighter subscription than a fresh send: no turn
 * lease, no segment relay wiring, no optimistic user message. It only needs
 * to keep the visible thread advancing until `chat-complete` lands.
 */
export function subscribeReattachedRun(options: {
  sessionId: string;
  /** True while this re-attach is still the active view; detach otherwise. */
  isLive: () => boolean;
  setMessages: Dispatch<SetStateAction<AgentChatMessage[]>>;
  setStreamingTools: Dispatch<SetStateAction<ToolCallStatus[]>>;
  setMessageTools: Dispatch<SetStateAction<Map<number, ToolCallStatus[]>>>;
  setCollapsedSections: Dispatch<SetStateAction<Set<number>>>;
  setPendingClarify: Dispatch<SetStateAction<PendingClarification | null>>;
  setClarifyInput: Dispatch<SetStateAction<string>>;
  setClarificationAnswering: Dispatch<SetStateAction<boolean>>;
  setClarificationError: Dispatch<SetStateAction<string | null>>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  streamingMsgIdx: MutableRefObject<number>;
  toolIdCounter: MutableRefObject<number>;
  /** Called after chat-complete so the caller can refresh the session rail. */
  onTurnComplete?: () => void;
  /** Re-read the durable session after completion to make it authoritative. */
  onRunSettled?: () => void;
}): Array<() => void> {
  const {
    sessionId, isLive, setMessages, setStreamingTools, setMessageTools,
    setCollapsedSections, setPendingClarify, setClarifyInput,
    setClarificationAnswering, setClarificationError, setLoading,
    streamingMsgIdx, toolIdCounter, onTurnComplete, onRunSettled,
  } = options;
  const segment: SegmentState = createSegmentState();
  const unsubs: Array<() => void> = [];
  // Debounced text deltas append to the CURRENT trailing assistant bubble.
  const ensureAssistant = () => {
    if (segment.msgIndex >= 0) return;
    setMessages(prev => {
      if (segment.msgIndex >= 0) return prev;
      segment.msgIndex = prev.length;
      streamingMsgIdx.current = prev.length;
      return [...prev, { role: 'assistant', content: '', timestamp: Date.now() }];
    });
  };
  const publishTools = () => {
    if (!isLive()) return;
    const snapshot = [...segment.tools];
    setStreamingTools(snapshot);
    if (segment.msgIndex >= 0) {
      setMessageTools(prev => new Map(prev).set(segment.msgIndex, snapshot));
    }
  };
  const batcher = createMessageDeltaBatcher({
    segment,
    setMessages,
    isCurrent: isLive,
  });
  const guard = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => {
    if (!isLive()) return;
    fn(...args);
  };
  const findTool = (toolCallId: string | undefined, name?: string) => {
    if (toolCallId) {
      const byId = segment.tools.find(tool => tool.toolCallId === toolCallId);
      if (byId) return byId;
    }
    if (name) return segment.tools.find(tool => tool.name === name && tool.status === 'running');
    return undefined;
  };

  const onToolInputStart = guard((data: unknown) => {
    const d = data as { id: string; toolName: string };
    ensureAssistant();
    upsertToolInputStart(segment.tools, d, () => ++toolIdCounter.current);
    publishTools();
  });
  const onToolInputDelta = guard((data: unknown) => {
    const d = data as { id: string; delta: string };
    const tool = findTool(d.id);
    if (!tool) return;
    tool.partialInput = (tool.partialInput ?? '') + d.delta;
    publishTools();
  });
  const onToolInputEnd = guard((data: unknown) => {
    const tool = findTool((data as { id: string }).id);
    if (!tool) return;
    tool.inputStreaming = false;
    publishTools();
  });
  const onToolCall = guard((data: unknown) => {
    const d = data as { name: string; args: unknown; toolCallId?: string };
    ensureAssistant();
    const existing = findTool(d.toolCallId, d.name);
    if (existing) {
      existing.args = d.args;
      existing.inputStreaming = false;
    } else {
      segment.tools.push({
        id: ++toolIdCounter.current,
        name: d.name,
        args: d.args,
        toolCallId: d.toolCallId,
        status: 'running',
      });
    }
    publishTools();
  });
  const onToolResult = guard((data: unknown) => {
    markToolResult(segment.tools, data as Parameters<typeof markToolResult>[1]);
    publishTools();
  });
  const onTextDelta = guard((delta: unknown) => {
    ensureAssistant();
    batcher.push(delta as string);
  });
  const onClarifyRequest = guard((request: unknown) => {
    ensureAssistant();
    setPendingClarify(request as AgentClarificationRequest);
    setClarifyInput('');
    setClarificationError(null);
  });
  let completionObserved = false;
  const onChatComplete = guard((payload: unknown) => {
    if (completionObserved) return;
    completionObserved = true;
    const result = payload as {
      ok: boolean;
      response?: string;
      error?: string;
      stopped?: boolean;
    };
    batcher.flush();
    if (segment.tools.length > 0) {
      setCollapsedSections(prev => {
        const next = new Set(prev);
        if (result.ok) next.add(segment.msgIndex);
        return next;
      });
      if (!result.ok || result.stopped) {
        settleRunningTools(
          segment.tools,
          result.stopped ? 'cancelled' : 'failed',
          result.stopped ? 'cancelled' : (result.error ?? 'failed'),
        );
      }
      setMessageTools(prev => {
        const next = new Map(prev);
        if (segment.msgIndex >= 0) next.set(segment.msgIndex, [...segment.tools]);
        return next;
      });
    }
    setStreamingTools([]);
    setLoading(false);
    onTurnComplete?.();
    onRunSettled?.();
  });

  const handlers: Partial<Record<string, (payload: unknown) => void>> = {
    'tool-input-start': onToolInputStart,
    'tool-input-delta': onToolInputDelta,
    'tool-input-end': onToolInputEnd,
    'tool-call': onToolCall,
    'tool-result': onToolResult,
    'text-delta': onTextDelta,
    'clarify-request': onClarifyRequest,
    'chat-complete': onChatComplete,
  };

  // Reattached runs use the main-process journal instead of transient IPC
  // listeners. Events emitted while this surface showed another conversation
  // are replayed exactly once from the sequence cursor.
  let cursor = 0;
  let cancelled = false;
  let timer: number | undefined;
  const getRunStatus = window.canvasWorkspace.agent.getRunStatus;
  if (typeof getRunStatus !== 'function') return unsubs;
  const poll = async () => {
    const status = await getRunStatus(sessionId, cursor)
      .catch(() => ({ ok: false, active: true }));
    if (cancelled || !isLive()) return;
    if (!status.ok) {
      timer = window.setTimeout(() => void poll(), 250);
      return;
    }
    const replay = 'replay' in status ? status.replay : undefined;
    if (replay) {
      for (const event of replay.events) {
        if (event.sequence <= cursor) continue;
        handlers[event.channel]?.(event.data);
        cursor = event.sequence;
      }
      cursor = Math.max(cursor, replay.cursor);
    }
    if (!status.active) {
      batcher.flush();
      if (!completionObserved) {
        setStreamingTools([]);
        setLoading(false);
        onTurnComplete?.();
        onRunSettled?.();
      }
      return;
    }
    timer = window.setTimeout(() => void poll(), 120);
  };
  void poll();
  unsubs.push(() => {
    cancelled = true;
    if (timer !== undefined) window.clearTimeout(timer);
    batcher.cancel();
  });

  return unsubs;
}
