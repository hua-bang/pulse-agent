import type { AgentChatMessage } from '../../../types';

const THREAD_CACHE_LIMIT = 20;
const threadCache = new Map<string, AgentChatMessage[]>();

export function getCachedThread(scopeKey: string): AgentChatMessage[] {
  return threadCache.get(scopeKey) ?? [];
}

export function cacheThread(scopeKey: string, messages: AgentChatMessage[]): void {
  threadCache.delete(scopeKey);
  threadCache.set(scopeKey, messages);
  if (threadCache.size > THREAD_CACHE_LIMIT) {
    const oldestKey = threadCache.keys().next().value;
    if (oldestKey !== undefined) threadCache.delete(oldestKey);
  }
}
