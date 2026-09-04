import { useLayoutEffect, useSyncExternalStore } from 'react';
import { conversationKeyId, type ConversationKey } from '../../../../../shared/conversation-runtime';

export type ConversationCompletionStatus = 'done' | 'failed' | 'stopped';

export interface ConversationCompletionActivity {
  key: ConversationKey;
  status: ConversationCompletionStatus;
  finishedAt: number;
  notified: boolean;
  completionId: string;
  title?: string;
}

const activities = new Map<string, ConversationCompletionActivity>();
const listeners = new Set<() => void>();
const visibleConversations = new Map<string, number>();
const seenCompletionIds = new Set<string>();
const SEEN_COMPLETION_LIMIT = 200;
let snapshot: ConversationCompletionActivity[] = [];

const publish = () => {
  snapshot = [...activities.values()];
  for (const listener of listeners) listener();
};

export function recordConversationCompletion(
  key: ConversationKey,
  status: ConversationCompletionStatus,
  completionId: string,
  title?: string,
): void {
  const id = conversationKeyId(key);
  if (seenCompletionIds.has(completionId)) return;
  seenCompletionIds.add(completionId);
  if (seenCompletionIds.size > SEEN_COMPLETION_LIMIT) {
    const oldest = seenCompletionIds.values().next().value;
    if (oldest) seenCompletionIds.delete(oldest);
  }
  activities.set(id, {
    key: { ...key },
    status,
    finishedAt: Date.now(),
    notified: false,
    completionId,
    title,
  });
  publish();
}

export function setConversationVisible(key: ConversationKey, visible: boolean): void {
  const id = conversationKeyId(key);
  const count = visibleConversations.get(id) ?? 0;
  if (visible) {
    visibleConversations.set(id, count + 1);
    if (count === 0) clearConversationCompletion(key);
  }
  else if (count <= 1) visibleConversations.delete(id);
  else visibleConversations.set(id, count - 1);
}

export function isConversationVisible(key: ConversationKey): boolean {
  return (visibleConversations.get(conversationKeyId(key)) ?? 0) > 0;
}

export function useConversationVisibility(key: ConversationKey, visible: boolean): void {
  useLayoutEffect(() => {
    if (!visible) return;
    setConversationVisible(key, true);
    return () => setConversationVisible(key, false);
  }, [key.storeId, key.sessionId, visible]);
}

export function clearConversationCompletion(key: ConversationKey): void {
  if (!activities.delete(conversationKeyId(key))) return;
  publish();
}

export function markConversationCompletionNotified(key: ConversationKey): void {
  const id = conversationKeyId(key);
  const activity = activities.get(id);
  if (!activity || activity.notified) return;
  activities.set(id, { ...activity, notified: true });
  publish();
}

export function useConversationCompletions(): readonly ConversationCompletionActivity[] {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
}

export function readConversationCompletions(): readonly ConversationCompletionActivity[] {
  return snapshot;
}

export function resetConversationCompletionStoreForTests(): void {
  activities.clear();
  visibleConversations.clear();
  seenCompletionIds.clear();
  snapshot = [];
  for (const listener of listeners) listener();
}
