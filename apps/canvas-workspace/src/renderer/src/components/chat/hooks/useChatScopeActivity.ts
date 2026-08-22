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
  /** Latest conversation session id; runs on OTHER sessions do not make this one busy. */
  getConversationSessionId: () => string | null | undefined;
  onExternalRunComplete: (messages: AgentChatMessage[]) => void;
  onRemoteRunState?: (state: {
    active: boolean;
    sessionId?: string;
    conversationSessionId?: string;
    pendingClarification?: AgentClarificationRequest;
  }) => void;
}

export function useChatScopeActivity({
  scope,
  scopeKey,
  getConversationSessionId,
  onExternalRunComplete,
  onRemoteRunState,
}: UseChatScopeActivityOptions) {
  const ownerRef = useRef(Symbol('chat-surface'));
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const sessionIdRef = useRef<string | null | undefined>(undefined);
  sessionIdRef.current = getConversationSessionId();
  const reportedRemoteRunRef = useRef<string | null>(null);
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
      const currentSessionId = sessionIdRef.current;
      const result = await agent
        .getScopeRunStatus({ scope: scopeRef.current }, currentSessionId ?? undefined)
        .catch(() => ({
          ok: false,
          active: false,
          conversationSessionId: undefined,
        }));
      if (cancelled) return;
      if (!result.ok) {
        timer = window.setTimeout(() => void poll(), 1_000);
        return;
      }
      // Per-session busy: only a run on the conversation this surface is
      // currently showing counts. A different conversation streaming in the
      // same workspace must NOT block this one (parallel conversations).
      // `conversationSessionId === undefined` means a legacy scope-exclusive
      // run, which conservatively counts as busy for every session.
      const sameConversation = (
        result.conversationSessionId === undefined
        || result.conversationSessionId === currentSessionId
      );
      const activeElsewhere = result.ok
        && result.active
        && sameConversation
        && !isChatScopeOwnedBy(scopeKey, ownerRef.current);
      setRemoteBusyElsewhere(activeElsewhere);
      if (activeElsewhere) {
        reportedRemoteRunRef.current = result.conversationSessionId
          ?? currentSessionId
          ?? '__legacy__';
        onRemoteRunState?.({
          active: true,
          sessionId: 'sessionId' in result ? result.sessionId : undefined,
          conversationSessionId: 'conversationSessionId' in result
            ? result.conversationSessionId
            : undefined,
          pendingClarification: 'pendingClarification' in result
            ? result.pendingClarification
            : undefined,
        });
      } else if (reportedRemoteRunRef.current) {
        const currentConversationKey = currentSessionId ?? '__legacy__';
        if (reportedRemoteRunRef.current !== currentConversationKey) {
          // The surface moved to another conversation. Its turn lease already
          // reset the visible state; an inactive status for the NEW session is
          // not evidence that the previously observed run completed.
          reportedRemoteRunRef.current = null;
        } else if (!result.active) {
          // Only main's explicit inactive status is completion. Reclaiming an
          // active run also flips busyElsewhere true → false, but must not load
          // durable history over the replayed in-flight assistant message.
          reportedRemoteRunRef.current = null;
          onRemoteRunState?.({ active: false });
          const expectedSessionId = currentSessionId;
          void agent.getHistory({ scope: scopeRef.current }).then(history => {
            if (
              history.ok
              && history.messages
              && sessionIdRef.current === expectedSessionId
            ) {
              onExternalRunComplete(history.messages);
            }
          }).catch(() => undefined);
        }
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

  return { busyElsewhere, claimScope, releaseScope, trackScopeRun };
}
