import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import type { AgentChatMessage } from '../../../types';
import type { RoleTurnEndEvent, RoleTurnRoleRef, RoleTurnStartEvent } from '../../../../../shared/agent-roles';
import type { ToolCallStatus } from '../types';
import { settleRunningTools } from './toolStreamState';

/** Relay progress for the bar above the composer (only shown when total > 1). */
export interface RelayProgress {
  queue: Array<RoleTurnRoleRef | null>;
  /** Index currently speaking; equals `total` once every segment finished. */
  speaking: number;
  total: number;
  /** Set while a graceful stop is pending main-side confirmation. */
  stopping?: boolean;
}

/**
 * Mutable per-turn segment state shared between the stream handlers. One
 * turn = 1..N segments; each segment owns one assistant bubble and its own
 * tool-call list.
 */
export interface SegmentState {
  /** Message index of the in-flight segment's bubble, -1 when none. */
  msgIndex: number;
  /** Live tool-call list for the in-flight segment. */
  tools: ToolCallStatus[];
  /** Count of segments frozen by role-turn-end this turn. */
  finalized: number;
}

export const createSegmentState = (): SegmentState => ({ msgIndex: -1, tools: [], finalized: 0 });

interface SegmentDeps {
  segment: SegmentState;
  streamingMsgIdx: MutableRefObject<number>;
  flushDeltas: () => void;
  setMessages: Dispatch<SetStateAction<AgentChatMessage[]>>;
  setMessageTools: Dispatch<SetStateAction<Map<number, ToolCallStatus[]>>>;
  setCollapsedSections: Dispatch<SetStateAction<Set<number>>>;
  setStreamingTools: Dispatch<SetStateAction<ToolCallStatus[]>>;
  setRelay: Dispatch<SetStateAction<RelayProgress | null>>;
}

/**
 * Segment lifecycle handlers for a turn's `role-turn-start` / `role-turn-end`
 * events. Every turn emits them (total=1 for single-speaker turns); a
 * multi-role relay emits one pair per speaking role. Start opens a fresh
 * attributed bubble; end freezes it with the authoritative response +
 * speaker snapshot so the NEXT segment's deltas can never bleed into it.
 */
export function createRelayTurnHandlers(deps: SegmentDeps) {
  const {
    segment, streamingMsgIdx, flushDeltas,
    setMessages, setMessageTools, setCollapsedSections, setStreamingTools, setRelay,
  } = deps;

  const handleRoleTurnStart = (event: RoleTurnStartEvent): void => {
    flushDeltas();
    segment.tools = [];
    setStreamingTools([]);
    setMessages(prev => {
      segment.msgIndex = prev.length;
      streamingMsgIdx.current = prev.length;
      return [...prev, {
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        speakerRoleId: event.speakerRole?.id,
        speakerRoleName: event.speakerRole?.name,
        speakerRoleColor: event.speakerRole?.color,
      }];
    });
    if (event.total > 1) {
      setRelay(prev => ({
        queue: event.queue,
        speaking: event.index,
        total: event.total,
        stopping: prev?.stopping,
      }));
    }
  };

  const handleRoleTurnEnd = (event: RoleTurnEndEvent): void => {
    flushDeltas();
    settleRunningTools(segment.tools);
    const toolSnapshot = segment.tools.length > 0 ? segment.tools.map(tool => ({ ...tool })) : undefined;
    const index = segment.msgIndex;
    if (index >= 0) {
      setMessages(prev => {
        if (index >= prev.length) return prev;
        const next = [...prev];
        next[index] = {
          ...next[index],
          content: event.response,
          runId: event.runId ?? next[index].runId,
          toolCalls: toolSnapshot ?? next[index].toolCalls,
          speakerRoleId: event.speakerRole?.id,
          speakerRoleName: event.speakerRole?.name,
          speakerRoleColor: event.speakerRole?.color,
        };
        return next;
      });
      if (toolSnapshot) {
        setMessageTools(prev => new Map(prev).set(index, toolSnapshot));
        setCollapsedSections(prev => new Set(prev).add(index));
      }
    }
    segment.finalized += 1;
    segment.msgIndex = -1;
    segment.tools = [];
    streamingMsgIdx.current = -1;
    setStreamingTools([]);
    setRelay(prev => (prev ? { ...prev, speaking: event.index + 1 } : prev));
  };

  return { handleRoleTurnStart, handleRoleTurnEnd };
}

/**
 * Final merge policy at chat-complete. Segments already frozen by
 * role-turn-end are never touched — this settles a still-in-flight bubble
 * (error, or a turn whose segment events went missing) or appends a fresh
 * error message when the failure happened between segments.
 */
export function applyTurnCompletion(opts: {
  completeResult: {
    ok: boolean;
    response?: string;
    runId?: string;
    error?: string;
    speakerRole?: RoleTurnRoleRef;
    aborted?: boolean;
  };
  segment: SegmentState;
  toolSnapshot?: ToolCallStatus[];
  setMessages: Dispatch<SetStateAction<AgentChatMessage[]>>;
}): void {
  const { completeResult, segment, toolSnapshot, setMessages } = opts;
  const merge = (message: AgentChatMessage): AgentChatMessage => ({
    ...message,
    toolCalls: toolSnapshot ?? message.toolCalls,
    runId: completeResult.runId ?? message.runId,
    aborted: completeResult.aborted,
    // Authoritative speaker snapshot; undefined intentionally clears a
    // streaming-time badge whose role mention turned out stale or errored.
    speakerRoleId: completeResult.speakerRole?.id,
    speakerRoleName: completeResult.speakerRole?.name,
    speakerRoleColor: completeResult.speakerRole?.color,
  });

  if (!completeResult.ok) {
    const errorText = `Error: ${completeResult.error ?? 'Unknown error'}`;
    setMessages(prev => {
      const index = segment.msgIndex;
      if (index < 0 || index >= prev.length) {
        return [...prev, merge({ role: 'assistant', content: errorText, timestamp: Date.now() })];
      }
      const next = [...prev];
      next[index] = merge({ ...next[index], content: next[index].content || errorText });
      return next;
    });
    return;
  }

  setMessages(prev => {
    const index = segment.msgIndex;
    if (index >= 0 && index < prev.length) {
      const next = [...prev];
      // An aborted turn's engine-side response is at best a partial echo of
      // what already streamed, at worst the generic "Request aborted."
      // filler — never an improvement over the bubble the user already saw.
      // Keep it and just flag the turn stopped instead of clobbering it.
      const content = completeResult.aborted
        ? (next[index].content || completeResult.response || '')
        : (completeResult.response ?? next[index].content);
      next[index] = merge({ ...next[index], content });
      return next;
    }
    if (segment.finalized === 0 && completeResult.response) {
      // Legacy fallback: a turn that emitted no segment events at all.
      return [...prev, merge({ role: 'assistant', content: completeResult.response, timestamp: Date.now() })];
    }
    return prev;
  });
}
