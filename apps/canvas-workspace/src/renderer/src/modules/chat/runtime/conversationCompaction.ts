import { useSyncExternalStore } from 'react';

/**
 * When each running conversation started compacting its context, keyed by
 * session id. The turn observer sets it on a compaction start and clears it on
 * the end or on the next stream activity; the activity status reads it.
 */
const compactingSince = new Map<string, number>();
const listeners = new Set<() => void>();

const notify = () => {
  for (const listener of [...listeners]) listener();
};

export function setConversationCompacting(sessionId: string, compacting: boolean): void {
  if (compacting === compactingSince.has(sessionId)) return;
  if (compacting) compactingSince.set(sessionId, Date.now());
  else compactingSince.delete(sessionId);
  notify();
}

export function readConversationCompactingSince(sessionId: string | undefined): number | null {
  return sessionId ? compactingSince.get(sessionId) ?? null : null;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Start time of the session's running compaction, or null. */
export function useConversationCompactingSince(sessionId: string | undefined): number | null {
  const read = () => readConversationCompactingSince(sessionId);
  return useSyncExternalStore(subscribe, read, read);
}
