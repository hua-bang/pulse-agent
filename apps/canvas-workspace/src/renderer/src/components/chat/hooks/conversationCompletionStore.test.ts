import { afterEach, describe, expect, it } from 'vitest';
import { conversationKey } from '../../../../../shared/conversation-runtime';
import {
  clearConversationCompletion,
  markConversationCompletionNotified,
  readConversationCompletions,
  recordConversationCompletion,
  resetConversationCompletionStoreForTests,
} from './conversationCompletionStore';

const key = conversationKey({ kind: 'workspace', workspaceId: 'ws-a' }, 'session-a');

afterEach(resetConversationCompletionStoreForTests);

describe('conversation completion store', () => {
  it('keeps a terminal outcome until the conversation is opened', () => {
    recordConversationCompletion(key, 'done', 'run-1');
    expect(readConversationCompletions()).toMatchObject([{
      key,
      status: 'done',
      notified: false,
      completionId: 'run-1',
    }]);

    markConversationCompletionNotified(key);
    expect(readConversationCompletions()[0]?.notified).toBe(true);

    recordConversationCompletion(key, 'done', 'run-1');
    expect(readConversationCompletions()[0]?.notified).toBe(true);

    clearConversationCompletion(key);
    expect(readConversationCompletions()).toEqual([]);

    recordConversationCompletion(key, 'done', 'run-1');
    expect(readConversationCompletions()).toEqual([]);
  });
});
