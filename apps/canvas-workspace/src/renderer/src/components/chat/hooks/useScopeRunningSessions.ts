import { useEffect, useMemo, useState } from 'react';
import { scopeSessionStoreId } from '../../../../../shared/agent-chat';
import type { AgentScope } from '../types';
import { useConversationSnapshots } from '../../../agent-chat/runtime/conversationStore';

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
  const localSnapshots = useConversationSnapshots(scopeSessionStoreId(scope));
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
      const result = await agent
        .getScopeRunningSessions({ scope })
        .catch(() => ({ ok: false, conversationSessionIds: [] as string[] }));
      if (cancelled) return;
      setRunning(result.ok ? new Set(result.conversationSessionIds) : new Set());
      timer = window.setTimeout(() => void poll(), pollMs);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pollMs, scope, scopeKey]);

  return useMemo(() => new Set([...running, ...localRunning]), [localRunning, running]);
}
