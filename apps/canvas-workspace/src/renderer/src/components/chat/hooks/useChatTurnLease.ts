import { useCallback, useRef } from 'react';

export interface ChatTurnLease {
  isCurrent: () => boolean;
  registerCleanup: (cleanup: () => void) => void;
  registerSuperseded: (rollback: () => void) => void;
  retire: (reason?: 'settled' | 'superseded') => boolean;
}

/** Keeps a late async turn from releasing or resetting a newer turn. */
export function useChatTurnLease(onActiveTurnRetired: () => void) {
  const activeTurnRef = useRef<ChatTurnLease | null>(null);

  const beginTurn = useCallback((): ChatTurnLease | null => {
    if (activeTurnRef.current) return null;
    let disposed = false;
    let cleanup: (() => void) | undefined;
    let rollback: (() => void) | undefined;
    let retireReason: 'settled' | 'superseded' | undefined;
    const lease: ChatTurnLease = {
      isCurrent: () => !disposed && activeTurnRef.current === lease,
      registerCleanup: (nextCleanup) => {
        if (disposed) nextCleanup();
        else cleanup = nextCleanup;
      },
      registerSuperseded: (nextRollback) => {
        if (retireReason === 'superseded') nextRollback();
        else if (!disposed) rollback = nextRollback;
      },
      retire: (reason = 'settled') => {
        if (disposed) return false;
        disposed = true;
        retireReason = reason;
        const owned = activeTurnRef.current === lease;
        if (owned) activeTurnRef.current = null;
        try {
          cleanup?.();
        } finally {
          try {
            if (reason === 'superseded') rollback?.();
          } finally {
            if (owned) onActiveTurnRetired();
          }
        }
        return owned;
      },
    };
    activeTurnRef.current = lease;
    return lease;
  }, [onActiveTurnRetired]);

  const disposeCurrentTurn = useCallback(() => {
    activeTurnRef.current?.retire('settled');
  }, []);
  const retireCurrentTurn = useCallback(() => {
    activeTurnRef.current?.retire('superseded');
  }, []);

  return { beginTurn, disposeCurrentTurn, retireCurrentTurn };
}
