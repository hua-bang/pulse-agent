import { useEffect, useMemo, useState } from 'react';
import { scopeSessionStoreId } from '../../../../../shared/agent-chat';
import { conversationKeyId } from '../../../../../shared/conversation-runtime';
import { scopeFromSessionStoreId } from '../target/sessionScope';
import type { AgentScope } from '../../../types';
import {
  readConversationSnapshots,
  useConversationSnapshots,
} from '../runtime/conversationStore';

/** Poll each rail store, retaining the full conversation identity across scopes. */
export function useRunningConversationKeys(
  storeIds: readonly string[],
  pollMs = 800,
): Set<string> {
  const storesKey = JSON.stringify([...new Set(storeIds)].sort());
  const stores = useMemo(() => JSON.parse(storesKey) as string[], [storesKey]);
  const [running, setRunning] = useState<Set<string>>(new Set());
  const localSnapshots = useConversationSnapshots();
  const localRunning = useMemo(
    () => new Set(localSnapshots
      .filter(snapshot => snapshot.status === 'running')
      .map(snapshot => conversationKeyId(snapshot.key))),
    [localSnapshots],
  );

  useEffect(() => {
    let cancelled = false;
    const timers = new Set<number>();
    setRunning(new Set());
    // Independent per-store polls: a slow scope must not stall the other rows.
    const poll = async (storeId: string) => {
      const agent = window.canvasWorkspace?.agent;
      if (!agent) return;
      const startedSnapshots = new Map(
        readConversationSnapshots(storeId).map(snapshot => [snapshot.key.sessionId, snapshot]),
      );
      const result = await agent
        .getScopeRunningSessions({ scope: scopeFromSessionStoreId(storeId) })
        .catch(() => ({ ok: false, conversationSessionIds: [] as string[] }));
      if (cancelled) return;
      const currentSnapshots = new Map(
        readConversationSnapshots(storeId).map(snapshot => [snapshot.key.sessionId, snapshot]),
      );
      const activeKeys = result.ok
        ? result.conversationSessionIds.filter(sessionId => {
            const started = startedSnapshots.get(sessionId);
            const current = currentSnapshots.get(sessionId);
            return !(current?.status === 'idle' && current !== started);
          }).map(sessionId => conversationKeyId({ storeId, sessionId }))
        : [];
      setRunning(previous => {
        const next = new Set([...previous].filter(key => !key.startsWith(`${storeId}\u0000`)));
        activeKeys.forEach(key => next.add(key));
        return next.size === previous.size && [...next].every(key => previous.has(key))
          ? previous
          : next;
      });
      const timer = window.setTimeout(() => {
        timers.delete(timer);
        void poll(storeId);
      }, pollMs);
      timers.add(timer);
    };
    stores.forEach(storeId => void poll(storeId));
    return () => {
      cancelled = true;
      timers.forEach(timer => window.clearTimeout(timer));
    };
  }, [pollMs, stores]);

  return useMemo(() => new Set([...running, ...localRunning]), [localRunning, running]);
}

/** Single-scope adapter for consumers that only need local session ids. */
export function useScopeRunningSessions(
  scope: AgentScope,
  _scopeKey: string,
  pollMs = 800,
): Set<string> {
  const storeId = scopeSessionStoreId(scope);
  const running = useRunningConversationKeys([storeId], pollMs);
  return useMemo(() => {
    const prefix = `${storeId}\u0000`;
    return new Set([...running].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length)));
  }, [running, storeId]);
}
