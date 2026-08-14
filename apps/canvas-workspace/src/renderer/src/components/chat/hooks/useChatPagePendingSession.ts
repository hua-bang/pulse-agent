import { useCallback, useEffect, useRef } from 'react';
import type { AgentScope } from '../types';

interface Options {
  busyElsewhere: boolean;
  handleLoadSession: (sessionId: string) => Promise<boolean | undefined>;
  onJumpToSession?: (session: { sessionId: string; scope: AgentScope }) => void;
  onSessionConsumed: (intentId: number, loaded: boolean) => void;
  pendingSessionId: string | null;
  pendingSessionIntentId: number | null;
  retrySession: () => Promise<void>;
  sessionScope: AgentScope;
}

export const useChatPagePendingSession = ({
  busyElsewhere,
  handleLoadSession,
  onJumpToSession,
  onSessionConsumed,
  pendingSessionId,
  pendingSessionIntentId,
  retrySession,
  sessionScope,
}: Options) => {
  const failedIntentRef = useRef<{ sessionId: string; scope: AgentScope } | null>(null);

  useEffect(() => {
    if (pendingSessionId === null || pendingSessionIntentId === null) return;
    const intent = { sessionId: pendingSessionId, scope: sessionScope };
    if (busyElsewhere) {
      failedIntentRef.current = intent;
      onSessionConsumed(pendingSessionIntentId, false);
      return;
    }
    failedIntentRef.current = null;
    let cancelled = false;
    void handleLoadSession(pendingSessionId).then((result) => {
      if (cancelled) return;
      const loaded = result !== false;
      failedIntentRef.current = loaded ? null : intent;
      onSessionConsumed(pendingSessionIntentId, loaded);
    });
    return () => { cancelled = true; };
    // busyElsewhere is sampled per intent; a later flip must not abandon the fetch.
  }, [handleLoadSession, onSessionConsumed, pendingSessionId, pendingSessionIntentId, sessionScope]);

  return useCallback(async () => {
    const failedIntent = failedIntentRef.current;
    if (failedIntent && onJumpToSession) {
      onJumpToSession(failedIntent);
      return;
    }
    await retrySession();
  }, [onJumpToSession, retrySession]);
};
