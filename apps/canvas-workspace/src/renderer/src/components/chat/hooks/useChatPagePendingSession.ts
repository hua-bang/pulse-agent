import { useCallback, useEffect, useRef } from 'react';

interface Options {
  busyElsewhere: boolean;
  handleLoadSession: (sessionId: string) => Promise<boolean | undefined>;
  onJumpToSession?: (session: { sessionId: string; workspaceId: string }) => void;
  onSessionConsumed: (intentId: number, loaded: boolean) => void;
  pendingSessionId: string | null;
  pendingSessionIntentId: number | null;
  retrySession: () => Promise<void>;
  sessionStoreId: string;
}

export const useChatPagePendingSession = ({
  busyElsewhere,
  handleLoadSession,
  onJumpToSession,
  onSessionConsumed,
  pendingSessionId,
  pendingSessionIntentId,
  retrySession,
  sessionStoreId,
}: Options) => {
  const failedIntentRef = useRef<{ sessionId: string; workspaceId: string } | null>(null);

  useEffect(() => {
    if (pendingSessionId === null || pendingSessionIntentId === null) return;
    const intent = { sessionId: pendingSessionId, workspaceId: sessionStoreId };
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
