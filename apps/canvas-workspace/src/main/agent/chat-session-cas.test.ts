import { describe, expect, it } from 'vitest';
import { rejectChangedChatSession } from './chat-session-cas';

describe('rejectChangedChatSession', () => {
  it('rejects stale renderer intent and reports the authoritative pointer', () => {
    expect(rejectChangedChatSession('session-old', 'session-new')).toEqual({
      ok: false,
      code: 'CHAT_SESSION_CHANGED',
      activeSessionId: 'session-new',
      error: 'This conversation changed before the message could start. The latest thread was restored.',
    });
  });

  it('allows matching and legacy unspecified pointers', () => {
    expect(rejectChangedChatSession('session-current', 'session-current')).toBeNull();
    expect(rejectChangedChatSession(undefined, 'session-current')).toBeNull();
  });
});
