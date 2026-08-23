import { useEffect, useMemo } from 'react';
import { conversationKeyId } from '../../../../../shared/conversation-runtime';
import {
  clearConversationCompletion,
  useConversationCompletions,
} from './conversationCompletionStore';

interface Options {
  selectedSessionKey: string | null;
}

export function useConversationCompletionNotices({
  selectedSessionKey,
}: Options) {
  const activities = useConversationCompletions();

  useEffect(() => {
    for (const activity of activities) {
      const selectionKey = `${activity.key.storeId}:${activity.key.sessionId}`;
      if (selectionKey === selectedSessionKey) clearConversationCompletion(activity.key);
    }
  }, [activities, selectedSessionKey]);

  return useMemo(() => new Map(
    activities.map(activity => [conversationKeyId(activity.key), activity.status]),
  ), [activities]);
}
