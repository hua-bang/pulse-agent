import type { ChatResponse } from './types';

export function rejectChangedChatSession(
  expectedSessionId: string | null | undefined,
  activeSessionId: string | null,
): ChatResponse | null {
  if (expectedSessionId === undefined || expectedSessionId === activeSessionId) return null;
  return {
    ok: false,
    code: 'CHAT_SESSION_CHANGED',
    activeSessionId,
    error: 'This conversation changed before the message could start. The latest thread was restored.',
  };
}
