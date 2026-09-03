import type { AgentSessionInfo, OtherWorkspaceSession } from '../../types';

interface CachedSessions {
  sessions: AgentSessionInfo[];
  otherSessions: OtherWorkspaceSession[];
}

const SESSIONS_CACHE_LIMIT = 20;
const sessionsCache = new Map<string, CachedSessions>();

export const readSessionsCache = (key: string): CachedSessions => (
  sessionsCache.get(key) ?? { sessions: [], otherSessions: [] }
);

export const hasSessionsCache = (key: string): boolean => sessionsCache.has(key);

export const patchSessionsCache = (key: string, patch: Partial<CachedSessions>): void => {
  const previous = readSessionsCache(key);
  sessionsCache.delete(key);
  sessionsCache.set(key, { ...previous, ...patch });
  if (sessionsCache.size <= SESSIONS_CACHE_LIMIT) return;
  const oldestKey = sessionsCache.keys().next().value;
  if (oldestKey !== undefined) sessionsCache.delete(oldestKey);
};

export const resetChatSessionsCacheForTests = (): void => {
  sessionsCache.clear();
};
