/**
 * Session-keyed compaction phases for the chat stream.
 *
 * Backends report when context compaction starts and ends; the conversation
 * IPC forwards them to the session's windows so the chat can say it is
 * compacting. A keyed bus keeps this out of `CanvasAgent.chat`'s positional
 * callback list, which is at its file-size baseline. A conversation runs one
 * turn at a time, so each session has at most one listener.
 */
import type { AgentCompactionPhase } from '../../../shared/api/agent-chat';

type Listener = (phase: AgentCompactionPhase) => void;

const listeners = new Map<string, Listener>();

export function publishCompactionPhase(sessionId: string, phase: AgentCompactionPhase): void {
  listeners.get(sessionId)?.(phase);
}

export function onCompactionPhase(sessionId: string, listener: Listener): () => void {
  listeners.set(sessionId, listener);
  return () => {
    if (listeners.get(sessionId) === listener) listeners.delete(sessionId);
  };
}
