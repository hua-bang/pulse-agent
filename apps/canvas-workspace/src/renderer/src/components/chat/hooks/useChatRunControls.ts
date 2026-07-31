import { useCallback, type Dispatch, type SetStateAction } from 'react';
import type { PendingClarification } from '../types';
import type { RelayProgress } from './relayTurnHandlers';

export function useChatRunControls(options: {
  activeSessionId: string | null;
  setRelay: Dispatch<SetStateAction<RelayProgress | null>>;
  setPendingClarify: Dispatch<SetStateAction<PendingClarification | null>>;
  setClarifyInput: Dispatch<SetStateAction<string>>;
}) {
  const { activeSessionId, setClarifyInput, setPendingClarify, setRelay } = options;

  const stopRelay = useCallback(async () => {
    if (!activeSessionId) return;
    setRelay(previous => (previous ? { ...previous, stopping: true } : previous));
    try {
      await window.canvasWorkspace.agent.stopRelay(activeSessionId);
    } catch (error) {
      console.error('[chat-panel] stop-relay failed:', error);
    }
  }, [activeSessionId, setRelay]);

  const abort = useCallback(async () => {
    if (!activeSessionId) return;
    setPendingClarify(null);
    setClarifyInput('');
    try {
      await window.canvasWorkspace.agent.abort(activeSessionId);
    } catch (error) {
      console.error('[chat-panel] abort failed:', error);
    }
  }, [activeSessionId, setClarifyInput, setPendingClarify]);

  return { abort, stopRelay };
}
