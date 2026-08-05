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

  const stopRelay = useCallback(async (): Promise<boolean> => {
    if (!activeSessionId) return false;
    setRelay(previous => (previous ? { ...previous, stopping: true } : previous));
    try {
      const result = await window.canvasWorkspace.agent.stopRelay(activeSessionId);
      if (!result.ok) {
        setRelay(previous => (previous ? { ...previous, stopping: false } : previous));
        console.error('[chat-panel] stop-relay failed:', result.error ?? 'Unknown error');
        return false;
      }
      return true;
    } catch (error) {
      setRelay(previous => (previous ? { ...previous, stopping: false } : previous));
      console.error('[chat-panel] stop-relay failed:', error);
      return false;
    }
  }, [activeSessionId, setRelay]);

  const abort = useCallback(async (): Promise<boolean> => {
    if (!activeSessionId) return false;
    try {
      const result = await window.canvasWorkspace.agent.abort(activeSessionId);
      if (!result.ok) {
        console.error('[chat-panel] abort failed:', result.error ?? 'Unknown error');
        return false;
      }
      setPendingClarify(null);
      setClarifyInput('');
      return true;
    } catch (error) {
      console.error('[chat-panel] abort failed:', error);
      return false;
    }
  }, [activeSessionId, setClarifyInput, setPendingClarify]);

  return { abort, stopRelay };
}
