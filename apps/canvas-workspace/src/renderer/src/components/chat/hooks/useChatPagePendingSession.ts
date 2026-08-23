import { useCallback, useEffect, useRef } from 'react';

interface Options {
  handleLoadSession: (sessionId: string) => Promise<boolean | undefined>;
  /** Abandon this surface's UI lease on any streaming run before switching threads. */
  onAbandonCurrentTurn?: () => void;
  onJumpToSession?: (session: { sessionId: string; workspaceId: string }) => void;
  onSessionConsumed: (intentId: number, loaded: boolean) => void;
  pendingSessionId: string | null;
  pendingSessionIntentId: number | null;
  retrySession: () => Promise<void>;
  sessionStoreId: string;
}

export const useChatPagePendingSession = ({
  handleLoadSession,
  onAbandonCurrentTurn,
  onJumpToSession,
  onSessionConsumed,
  pendingSessionId,
  pendingSessionIntentId,
  retrySession,
  sessionStoreId,
}: Options) => {
  const failedIntentRef = useRef<{ sessionId: string; workspaceId: string } | null>(null);
  const abandonRef = useRef(onAbandonCurrentTurn);
  abandonRef.current = onAbandonCurrentTurn;

  useEffect(() => {
    if (pendingSessionId === null || pendingSessionIntentId === null) return;
    const intent = { sessionId: pendingSessionId, workspaceId: sessionStoreId };
    failedIntentRef.current = null;
    // Switching conversations while a run streams: drop the UI lease so the
    // surface stops tracking the old run (it continues main-side,
    // session-anchored) and the newly shown conversation can send immediately.
    abandonRef.current?.();
    let cancelled = false;
    void handleLoadSession(pendingSessionId).then((result) => {
      if (cancelled) return;
      const loaded = result !== false;
      failedIntentRef.current = loaded ? null : intent;
      onSessionConsumed(pendingSessionIntentId, loaded);
    });
    return () => { cancelled = true; };
  }, [handleLoadSession, onSessionConsumed, pendingSessionId, pendingSessionIntentId, sessionStoreId]);

  return useCallback(async () => {
    const failedIntent = failedIntentRef.current;
    if (failedIntent && onJumpToSession) {
      onJumpToSession(failedIntent);
      return;
    }
    await retrySession();
  }, [onJumpToSession, retrySession]);
};
