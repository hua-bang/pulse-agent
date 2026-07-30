import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { AgentChatMessage, AgentClarificationRequest } from '../../../types';
import type { AgentScope } from '../types';
import {
  claimChatScope,
  isChatScopeBusyElsewhere,
  isChatScopeOwnedBy,
  releaseChatScope,
  subscribeChatScope,
  trackChatScopeRun,
} from './chatScopeActivityStore';

interface UseChatScopeActivityOptions {
  scope: AgentScope;
  scopeKey: string;
  onExternalRunComplete: (messages: AgentChatMessage[]) => void;
  onRemoteRunState?: (state: {
    active: boolean;
    sessionId?: string;
    pendingClarification?: AgentClarificationRequest;
  }) => void;
}

export function useChatScopeActivity({
  scope,
  scopeKey,
  onExternalRunComplete,
  onRemoteRunState,
}: UseChatScopeActivityOptions) {
  const ownerRef = useRef(Symbol('chat-surface'));
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const observedExternalRunRef = useRef<string | null>(null);
  const reportedRemoteRunRef = useRef(false);
  const subscribe = useCallback(
    (listener: () => void) => subscribeChatScope(scopeKey, listener),
    [scopeKey],
  );
  const readSnapshot = useCallback(
    () => isChatScopeBusyElsewhere(scopeKey, ownerRef.current),
    [scopeKey],
  );
  const localBusyElsewhere = useSyncExternalStore(subscribe, readSnapshot, () => false);
  const [remoteBusyElsewhere, setRemoteBusyElsewhere] = useState(false);

  const claimScope = useCallback(
    () => claimChatScope(scopeKey, ownerRef.current),
    [scopeKey],
  );
  const releaseScope = useCallback(
    () => releaseChatScope(scopeKey, ownerRef.current),
    [scopeKey],
  );
  useEffect(() => () => {
    releaseChatScope(scopeKey, ownerRef.current);
  }, [scopeKey]);

  const trackScopeRun = useCallback((sessionId: string) => {
    trackChatScopeRun(
      scopeKey,
      ownerRef.current,
      () => window.canvasWorkspace.agent.getRunStatus(sessionId),
    );
  }, [scopeKey]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const poll = async () => {
      const agent = window.canvasWorkspace?.agent;
      if (!agent) return;
      const result = await agent
        .getScopeRunStatus({ scope: scopeRef.current })
        .catch(() => ({ ok: false, active: false }));
      if (cancelled) return;
      if (!result.ok) {
        timer = window.setTimeout(() => void poll(), 1_000);
        return;
      }
      const activeElsewhere = result.ok
        && result.active
        && !isChatScopeOwnedBy(scopeKey, ownerRef.current);
      setRemoteBusyElsewhere(activeElsewhere);
      if (activeElsewhere) {
        reportedRemoteRunRef.current = true;
        onRemoteRunState?.({
          active: true,
          sessionId: 'sessionId' in result ? result.sessionId : undefined,
          pendingClarification: 'pendingClarification' in result
            ? result.pendingClarification
            : undefined,
        });
      } else if (reportedRemoteRunRef.current) {
        reportedRemoteRunRef.current = false;
        onRemoteRunState?.({ active: false });
      }
      timer = window.setTimeout(
        () => void poll(),
        result.ok && result.active ? 400 : 1_000,
      );
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      setRemoteBusyElsewhere(false);
    };
  }, [onRemoteRunState, scopeKey]);

  const busyElsewhere = localBusyElsewhere || remoteBusyElsewhere;

  useEffect(() => {
    if (busyElsewhere) {
      observedExternalRunRef.current = scopeKey;
      return;
    }
    if (observedExternalRunRef.current !== scopeKey) return;
    observedExternalRunRef.current = null;
    let cancelled = false;
    void window.canvasWorkspace.agent
      .getHistory({ scope: scopeRef.current })
      .then(result => {
        if (!cancelled && result.ok && result.messages) {
          onExternalRunComplete(result.messages);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [busyElsewhere, onExternalRunComplete, scopeKey]);

  return { busyElsewhere, claimScope, releaseScope, trackScopeRun };
}
