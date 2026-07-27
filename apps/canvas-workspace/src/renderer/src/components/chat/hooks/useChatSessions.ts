import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentChatMessage, AgentSessionInfo } from '../../../types';
import type { AgentScope, OtherWorkspaceSession, WorkspaceOption } from '../types';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { scopeSessionStoreId } from '../../../../../shared/agent-chat';

interface UseChatSessionsOptions {
  agentScope: AgentScope;
  allWorkspaces?: WorkspaceOption[];
  onMessagesLoaded: (messages: AgentChatMessage[]) => void;
  /** When true, load the session list on mount and whenever workspaceId changes. */
  eagerLoad?: boolean;
  /**
   * When true, don't call getHistory on mount. Use this when the caller is
   * about to load a specific session manually — avoids a race between the
   * initial getHistory and the pending loadSession.
   */
  skipInitialHistory?: boolean;
}

interface CachedSessions {
  sessions: AgentSessionInfo[];
  otherSessions: OtherWorkspaceSession[];
}

/**
 * Cross-mount, per-scope cache of the last-known session list. ChatPageBody
 * remounts this hook on every cross-workspace rail switch (React `key`), which
 * would otherwise reset sessions/otherSessions to empty and flash the rail's
 * empty state until loadSessions() re-fetches. Seeding initial state from here
 * repaints the last-known list instantly; loadSessions() still refreshes it in
 * the background. Module-scoped by design: shared by every useChatSessions()
 * instance (ChatPage's rail and ChatPanel's header dropdown alike).
 *
 * Bounded to the most recently touched scopes (Map insertion order doubles as
 * recency) so a long-running renderer visiting many workspaces/scheduled
 * tasks can't grow this unboundedly.
 */
const SESSIONS_CACHE_LIMIT = 20;
const sessionsCache = new Map<string, CachedSessions>();

function patchSessionsCache(key: string, patch: Partial<CachedSessions>): void {
  const prev = sessionsCache.get(key) ?? { sessions: [], otherSessions: [] };
  // Delete-then-set moves the key to the end of the Map's iteration order,
  // marking it most-recently-used.
  sessionsCache.delete(key);
  sessionsCache.set(key, { ...prev, ...patch });
  if (sessionsCache.size > SESSIONS_CACHE_LIMIT) {
    const oldestKey = sessionsCache.keys().next().value;
    if (oldestKey !== undefined) sessionsCache.delete(oldestKey);
  }
}

export function useChatSessions({
  agentScope,
  allWorkspaces,
  onMessagesLoaded,
  eagerLoad = false,
  skipInitialHistory = false,
}: UseChatSessionsOptions) {
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const scopeKey = agentScope.kind === 'workspace'
    ? `workspace:${agentScope.workspaceId}`
    : agentScope.kind === 'scheduled'
      ? `scheduled:${agentScope.taskId}`
      : 'global';

  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  // Lazy initializers only run once, at mount — a cache hit (revisiting an
  // already-loaded scope) repaints immediately instead of starting empty.
  const [sessions, setSessions] = useState<AgentSessionInfo[]>(
    () => sessionsCache.get(scopeKey)?.sessions ?? [],
  );
  const [otherSessions, setOtherSessions] = useState<OtherWorkspaceSession[]>(
    () => sessionsCache.get(scopeKey)?.otherSessions ?? [],
  );
  const [currentScopeName, setCurrentScopeName] = useState<string | null>(null);
  // A cache miss on an eager-load mount is about to trigger loadSessions()
  // in an effect below, which runs after the first paint — starting this
  // false would let that first paint fall through to the empty-state branch
  // (allSessions is [] until the fetch resolves) and briefly show "No
  // previous chats yet." on every scope's true first visit.
  const [sessionsLoading, setSessionsLoading] = useState(
    () => eagerLoad && !sessionsCache.has(scopeKey),
  );
  const sessionMenuRef = useRef<HTMLDivElement>(null);

  // Always read the latest scope inside the effect without making the effect
  // depend on the object's identity (see below).
  const agentScopeRef = useRef(agentScope);
  agentScopeRef.current = agentScope;

  // Reload history only when the scope actually changes. We key on `scopeKey`
  // (a stable string) rather than the `agentScope` object: a caller that
  // recreates the scope object on every render would otherwise re-fire this
  // effect on each streaming setState, and `onMessagesLoaded` (replaceMessages)
  // would clobber the in-flight assistant message — making intermediate tool
  // calls / streamed text disappear and the view flicker mid-turn.
  useEffect(() => {
    if (skipInitialHistory) return;
    void (async () => {
      const result = await window.canvasWorkspace.agent.getHistory({ scope: agentScopeRef.current });
      if (result.ok && result.messages) {
        onMessagesLoaded(result.messages);
      }
    })();
  }, [onMessagesLoaded, skipInitialHistory, scopeKey]);

  useClickOutside(sessionMenuRef, () => setSessionMenuOpen(false), sessionMenuOpen);
  const closeSessionMenu = useCallback(() => setSessionMenuOpen(false), []);

  const loadSessions = useCallback(async () => {
      setSessionsLoading(true);
      try {
      const result = await window.canvasWorkspace.agent.listSessions({ scope: agentScope });
      if (result.ok && result.sessions) {
        setSessions(result.sessions);
        patchSessionsCache(scopeKey, { sessions: result.sessions });
      }

      if (allWorkspaces && (agentScope.kind === 'global' || allWorkspaces.length > 1)) {
        const workspaceNameMap: Record<string, string> = {};
        for (const workspace of allWorkspaces) {
          workspaceNameMap[workspace.id] = workspace.name;
        }

        const allResult = await window.canvasWorkspace.agent.listAllSessions(workspaceNameMap);
        if (allResult.ok && allResult.groups) {
          // Groups are keyed by session-STORE id, which is the workspace id
          // only for workspace scopes; global chat and each scheduled task
          // have their own sentinel store. Dedupe on the store id so the
          // current scope is never listed twice.
          const currentStoreId = scopeSessionStoreId(agentScope);
          const flattened: OtherWorkspaceSession[] = [];
          for (const group of allResult.groups) {
            if (group.workspaceId === currentStoreId) {
              setCurrentScopeName(group.workspaceName);
              continue;
            }
            for (const session of group.sessions) {
              flattened.push({
                ...session,
                sourceWorkspaceId: group.workspaceId,
                workspaceName: group.workspaceName,
              });
            }
          }

          flattened.sort((left, right) => right.date.localeCompare(left.date));
          setOtherSessions(flattened);
          patchSessionsCache(scopeKey, { otherSessions: flattened });
        }
      } else {
        setOtherSessions([]);
        patchSessionsCache(scopeKey, { otherSessions: [] });
      }
    } finally {
      setSessionsLoading(false);
    }
  }, [agentScope, allWorkspaces, scopeKey, workspaceId]);

  useEffect(() => {
    if (!eagerLoad) return;
    void loadSessions();
  }, [eagerLoad, loadSessions]);

  const openSessionMenu = useCallback(async () => {
    if (sessionMenuOpen) {
      setSessionMenuOpen(false);
      return;
    }

    // Open immediately so the trigger feels responsive, then refresh the
    // session list in the background. Awaiting the IPC round-trip(s)
    // before opening made the title dropdown feel laggy — the menu only
    // appeared once `listSessions` (and `listAllSessions`) returned.
    setSessionMenuOpen(true);
    await loadSessions();
  }, [loadSessions, sessionMenuOpen]);

  const handleNewSession = useCallback(async () => {
    setSessionMenuOpen(false);
    const result = await window.canvasWorkspace.agent.newSession({ scope: agentScope });
    if (!result.ok) return result;
    onMessagesLoaded([]);
    return result;
  }, [agentScope, onMessagesLoaded]);

  const handleLoadSession = useCallback(async (sessionId: string, sourceWorkspaceId?: string) => {
    setSessionMenuOpen(false);

    const result = sourceWorkspaceId && workspaceId && sourceWorkspaceId !== workspaceId
      ? await window.canvasWorkspace.agent.loadCrossWorkspaceSession(workspaceId, sourceWorkspaceId, sessionId)
      : await window.canvasWorkspace.agent.loadSession({ scope: agentScope }, sessionId);

    if (result.ok && result.messages) {
      onMessagesLoaded(result.messages);
    }
  }, [agentScope, onMessagesLoaded, workspaceId]);

  return {
    otherSessions,
    currentScopeName,
    handleLoadSession,
    handleNewSession,
    loadSessions,
    closeSessionMenu,
    openSessionMenu,
    sessionMenuOpen,
    sessionMenuRef,
    sessions,
    sessionsLoading,
  };
}
