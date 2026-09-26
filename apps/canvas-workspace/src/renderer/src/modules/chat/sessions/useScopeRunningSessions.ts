import { useEffect, useMemo, useState } from 'react';
import { scopeSessionStoreId } from '../../../../../shared/agent-chat';
import type { AgentScope } from '../../../types';
import {
  readConversationSnapshots,
  useConversationSnapshots,
} from '../runtime/conversationStore';

/**
 * Polls main for every conversation session that currently has an active run
 * in `scope`. The session rail uses this to show a "Running" marker on
 * conversations that stream in the background (parallel conversations),
 * including ones this surface is not currently viewing.
 */
export function useScopeRunningSessions(
  scope: AgentScope,
  scopeKey: string,
  pollMs = 800,
): Set<string> {
  const [running, setRunning] = useState<Set<string>>(new Set());
  const storeId = scopeSessionStoreId(scope);
  const localSnapshots = useConversationSnapshots(storeId);
  const localRunning = useMemo(
    () => new Set(
      localSnapshots
        .filter(snapshot => snapshot.status === 'running')
        .map(snapshot => snapshot.key.sessionId),
    ),
    [localSnapshots],
  );

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      const agent = window.canvasWorkspace?.agent;
      if (!agent) return;
      const startedSnapshots = new Map(
        readConversationSnapshots(storeId).map(snapshot => [snapshot.key.sessionId, snapshot]),
      );
      const result = await agent
        .getScopeRunningSessions({ scope })
        .catch(() => ({ ok: false, conversationSessionIds: [] as string[] }));
      if (cancelled) return;
      const currentSnapshots = new Map(
        readConversationSnapshots(storeId).map(snapshot => [snapshot.key.sessionId, snapshot]),
      );
      setRunning(result.ok
        ? new Set(result.conversationSessionIds.filter(sessionId => {
            const started = startedSnapshots.get(sessionId);
            const current = currentSnapshots.get(sessionId);
            return !(
              started !== undefined
              && current?.status === 'idle'
              && current.sequence !== started.sequence
            );
          }))
        : new Set());
      timer = window.setTimeout(() => void poll(), pollMs);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pollMs, scope, scopeKey, storeId]);

  return useMemo(() => {
    const merged = new Set(running);
    localRunning.forEach(sessionId => merged.add(sessionId));
    return merged;
  }, [localRunning, running]);
}
