/**
 * Session-keyed compaction phases for the chat stream.
 *
 * Backends report when context compaction starts and ends; the conversation
 * IPC forwards them to the session's windows so the chat can say it is
 * compacting. A keyed bus keeps this out of `CanvasAgent.chat`'s positional
 * callback list, which is at its file-size baseline.
 */
import type { AgentCompactionPhase } from '../../../shared/api/agent-chat';

type Listener = (phase: AgentCompactionPhase) => void;

const listeners = new Map<string, Set<Listener>>();

export function publishCompactionPhase(sessionId: string, phase: AgentCompactionPhase): void {
  for (const listener of [...(listeners.get(sessionId) ?? [])]) listener(phase);
}

export function onCompactionPhase(sessionId: string, listener: Listener): () => void {
  const set = listeners.get(sessionId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(sessionId, set);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(sessionId);
  };
}
