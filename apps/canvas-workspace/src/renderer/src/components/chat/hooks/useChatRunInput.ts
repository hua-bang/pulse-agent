import { useCallback } from 'react';

import type { ChatRunInputMode } from '../../../types';

export function useChatRunInput(activeSessionId: string | null) {
  const submitRunInput = useCallback(async (mode: ChatRunInputMode, rawText: string) => {
    const text = rawText.trim();
    if (!activeSessionId || !text) return false;
    try {
      return (await window.canvasWorkspace.agent.submitRunInput(activeSessionId, mode, text)).ok;
    } catch {
      return false;
    }
  }, [activeSessionId]);

  return submitRunInput;
}
