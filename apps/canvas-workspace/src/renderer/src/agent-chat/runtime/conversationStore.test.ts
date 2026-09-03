import { afterEach, describe, expect, it } from 'vitest';
import { conversationKey } from '../../../../shared/conversation-runtime';
import {
  appendConversationText,
  appendConversationTextAt,
  pushConversationMessage,
  readConversationSnapshot,
  resetConversation,
  resetConversationStoreForTests,
  setConversationClarification,
  setConversationError,
  setConversationLoading,
  setConversationMessages,
  subscribeConversation,
} from './conversationStore';

const scope = { kind: 'workspace', workspaceId: 'ws-a' } as const;
const keyA = conversationKey(scope, 'session-a');
const keyB = conversationKey(scope, 'session-b');

afterEach(() => {
  resetConversationStoreForTests();
});

describe('renderer conversation store', () => {
  it('keys state by conversation, so switching is a different selector', () => {
    setConversationMessages(keyA, [{ role: 'user', content: 'A', timestamp: 0 }]);
    setConversationMessages(keyB, [{ role: 'user', content: 'B', timestamp: 0 }]);

    expect(readConversationSnapshot(keyA).messages.map(m => m.content)).toEqual(['A']);
    expect(readConversationSnapshot(keyB).messages.map(m => m.content)).toEqual(['B']);
  });

  it('notifies subscribers only for the changed conversation', () => {
    let aNotified = 0;
    let bNotified = 0;
    const unsubA = subscribeConversation(keyA, () => { aNotified += 1; });
    const unsubB = subscribeConversation(keyB, () => { bNotified += 1; });

    setConversationMessages(keyA, [{ role: 'user', content: 'A', timestamp: 0 }]);
    expect(aNotified).toBe(1);
    expect(bNotified).toBe(0);

    unsubA();
    setConversationMessages(keyA, []);
    expect(aNotified).toBe(1);

    unsubB();
  });

  it('appendConversationText targets the active assistant tail without touching other keys', () => {
    setConversationMessages(keyA, [{ role: 'user', content: 'hi', timestamp: 0 }]);
    setConversationMessages(keyB, [{ role: 'user', content: 'hey', timestamp: 0 }]);

    appendConversationText(keyA, ' world');

    expect(readConversationSnapshot(keyA).messages.map(m => m.content)).toEqual(['hi', ' world']);
    expect(readConversationSnapshot(keyB).messages.map(m => m.content)).toEqual(['hey']);
  });

  it('loading / clarification / error are per-conversation', () => {
    setConversationLoading(keyA, true);
    setConversationClarification(keyA, { id: 'req-1', question: 'confirm?' });
    setConversationError(keyB, 'boom');

    expect(readConversationSnapshot(keyA).status).toBe('running');
    expect(readConversationSnapshot(keyA).clarification?.id).toBe('req-1');
    expect(readConversationSnapshot(keyB).status).toBe('idle');
    expect(readConversationSnapshot(keyB).error).toBe('boom');
    expect(readConversationSnapshot(keyA).error).toBeNull();
  });

  it('appends stream text only to its turn-owned assistant slot', () => {
    setConversationMessages(keyA, [
      { role: 'assistant', content: 'current turn', timestamp: 0 },
      { role: 'assistant', content: 'unrelated tail', timestamp: 1 },
    ]);

    expect(appendConversationTextAt(keyA, 0, ' delta')).toBe(true);
    expect(readConversationSnapshot(keyA).messages.map(message => message.content))
      .toEqual(['current turn delta', 'unrelated tail']);
  });

  it('resetConversation clears only that conversation', () => {
    setConversationMessages(keyA, [{ role: 'user', content: 'A', timestamp: 0 }]);
    setConversationMessages(keyB, [{ role: 'user', content: 'B', timestamp: 0 }]);

    resetConversation(keyA);

    expect(readConversationSnapshot(keyA).messages).toEqual([]);
    expect(readConversationSnapshot(keyB).messages.map(m => m.content)).toEqual(['B']);
  });

  it('pushConversationMessage appends a message', () => {
    pushConversationMessage(keyA, { role: 'user', content: 'one', timestamp: 0 });
    pushConversationMessage(keyA, { role: 'assistant', content: 'two', timestamp: 0 });

    expect(readConversationSnapshot(keyA).messages.map(m => m.content)).toEqual(['one', 'two']);
  });
});
