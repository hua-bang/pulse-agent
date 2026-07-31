import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AgentChatMessage, AgentSessionInfo } from '../../../types';
import type { AgentScope, OtherWorkspaceSession, WorkspaceOption } from '../types';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { scopeSessionStoreId } from '../../../../../shared/agent-chat';
import { useI18n } from '../../../i18n';

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
   *
   * Setting this OBLIGES the caller to call handleLoadSession: `sessionLoading`
   * is seeded true at mount and, with the history fetch skipped, only a thread
   * fetch clears it.
   */
  skipInitialHistory?: boolean;
}

/** Shared shape of every IPC call that replaces the whole message thread. */
interface ThreadFetchResult {
  ok: boolean;
  messages?: AgentChatMessage[];
  activeSessionId?: string | null;
  code?: string;
  error?: string;
}

interface CachedSessions {
  sessions: AgentSessionInfo[];
  otherSessions: OtherWorkspaceSession[];
}

/** Cross-mount per-scope session-list cache, bounded by Map insertion recency. */
const SESSIONS_CACHE_LIMIT = 20;
const sessionsCache = new Map<string, CachedSessions>();

/** Test-only reset; production sessions intentionally survive surface remounts. */
export const resetChatSessionsCacheForTests = (): void => {
  sessionsCache.clear();
};

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
  const { t } = useI18n();
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const scopeKey = agentScope.kind === 'workspace'
    ? `workspace:${agentScope.workspaceId}`
    : agentScope.kind === 'scheduled'
      ? `scheduled:${agentScope.taskId}`
      : 'global';

  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  // Revisited scopes repaint their cached rail immediately.
  const [sessions, setSessions] = useState<AgentSessionInfo[]>(
    () => sessionsCache.get(scopeKey)?.sessions ?? [],
  );
  const [otherSessions, setOtherSessions] = useState<OtherWorkspaceSession[]>(
    () => sessionsCache.get(scopeKey)?.otherSessions ?? [],
  );
  const [currentScopeName, setCurrentScopeName] = useState<string | null>(null);
  // Avoid an empty-state flash before an eager first list fetch.
  const [sessionsLoading, setSessionsLoading] = useState(
    () => eagerLoad && !sessionsCache.has(scopeKey),
  );
  // Seed true: mount always starts history or an explicit session fetch.
  const [sessionLoading, setSessionLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<{
    code?: string;
    message: string;
  } | null>(null);
  // Only the newest thread request may paint or clear its busy flag.
  const threadRequestRef = useRef(0);
  const threadRetryRef = useRef<{
    scopeKey: string;
    fetchThread: () => Promise<ThreadFetchResult>;
    expectedSessionId?: string;
  } | null>(null);
  const sessionListRequestRef = useRef(0);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const previousScopeKeyRef = useRef(scopeKey);
  const historyHandledScopeRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (previousScopeKeyRef.current === scopeKey) return;
    sessionListRequestRef.current += 1;
    threadRequestRef.current += 1;
    onMessagesLoaded([]);
    setSessionsLoading(eagerLoad);
    // The scope-specific history or selected session fetch starts directly
    // after this layout pass. Mark it busy before paint so the composer cannot
    // submit into the scope while the main-side pointer is switching.
    setSessionLoading(true);
    setSessionError(null);
    setActiveSessionId(null);
    setSessionMenuOpen(false);
    previousScopeKeyRef.current = scopeKey;
  }, [eagerLoad, onMessagesLoaded, scopeKey]);

  useLayoutEffect(() => {
    if (!skipInitialHistory) return;
    sessionListRequestRef.current += 1;
    setSessionsLoading(true);
  }, [skipInitialHistory]);

  // Read the latest scope without depending on object identity.
  const agentScopeRef = useRef(agentScope);
  agentScopeRef.current = agentScope;

  // Reload history only when the scope actually changes. We key on `scopeKey`
  // (a stable string) rather than the `agentScope` object: a caller that
  // recreates the scope object on every render would otherwise re-fire this
  // effect on each streaming setState, and `onMessagesLoaded` (replaceMessages)
  // would clobber the in-flight assistant message — making intermediate tool
  // calls / streamed text disappear and the view flicker mid-turn.
  /** Runs a latest-wins thread replacement behind `sessionLoading`. */
  const runThreadFetch = useCallback(async (
    fetchThread: () => Promise<ThreadFetchResult>,
    expectedSessionId?: string,
  ) => {
    sessionListRequestRef.current += 1;
    setSessionsLoading(false);
    threadRetryRef.current = { scopeKey, fetchThread, expectedSessionId };
    const token = ++threadRequestRef.current;
    setSessionLoading(true);
    setSessionError(null);
    try {
      const result = await fetchThread();
      // A newer fetch (or a new-session reset) took over while this one was
      // open: neither its messages nor its "done" belong to what's on screen.
      if (token !== threadRequestRef.current) return undefined;
      if (result.activeSessionId !== undefined) {
        setActiveSessionId(result.activeSessionId);
      }
      if (!result.ok) {
        setSessionError({
          code: result.code,
          message: result.error ?? t('chat.sessionOpenFailed'),
        });
        return false;
      }
      if (
        expectedSessionId
        && result.activeSessionId !== undefined
        && result.activeSessionId !== expectedSessionId
      ) {
        setSessionError({
          code: 'SESSION_ACK_MISMATCH',
          message: t('chat.sessionAckMismatch'),
        });
        return false;
      }
      if (result.ok && result.messages) {
        onMessagesLoaded(result.messages);
      }
      return true;
    } catch (error) {
      if (token === threadRequestRef.current) {
        setSessionError({
          code: 'SESSION_LOAD_FAILED',
          message: error instanceof Error ? error.message : String(error),
        });
        return false;
      }
      return undefined;
    } finally {
      if (token === threadRequestRef.current) {
        setSessionLoading(false);
      }
    }
  }, [onMessagesLoaded, scopeKey, t]);

  useEffect(() => {
    // The caller is about to run its own handleLoadSession; leave
    // sessionLoading seeded true so the thread stays in its loading state
    // continuously instead of flashing empty between the two.
    if (skipInitialHistory) {
      historyHandledScopeRef.current = scopeKey;
      return;
    }
    // An explicit session load already initialized this scope. When the
    // parent clears pendingSessionId after that load, skipInitialHistory flips
    // back to false; do not immediately fetch the same history a second time.
    if (historyHandledScopeRef.current === scopeKey) return;
    historyHandledScopeRef.current = scopeKey;
    void runThreadFetch(() => window.canvasWorkspace.agent.getHistory({ scope: agentScopeRef.current }));
  }, [runThreadFetch, skipInitialHistory, scopeKey]);

  useClickOutside(sessionMenuRef, () => setSessionMenuOpen(false), sessionMenuOpen);
  const closeSessionMenu = useCallback(() => setSessionMenuOpen(false), []);

  const loadSessions = useCallback(async () => {
      const token = ++sessionListRequestRef.current;
      setSessionsLoading(true);
      try {
      const workspaceNameMap: Record<string, string> = {};
      for (const workspace of allWorkspaces ?? []) {
        workspaceNameMap[workspace.id] = workspace.name;
      }
      const [result, allResult] = await Promise.all([
        window.canvasWorkspace.agent.listSessions({ scope: agentScope }),
        allWorkspaces
          ? window.canvasWorkspace.agent.listAllSessions(workspaceNameMap)
          : Promise.resolve(null),
      ]);
      if (token !== sessionListRequestRef.current) return;
      let nextSessions: AgentSessionInfo[] | undefined;
      let nextOtherSessions: OtherWorkspaceSession[] | undefined;
      let nextCurrentScopeName: string | null | undefined;

      if (result.ok && result.sessions) {
        nextSessions = result.sessions;
        setActiveSessionId(result.sessions.find(session => session.isCurrent)?.sessionId ?? null);
      }

      if (allResult) {
        if (allResult.ok && allResult.groups) {
          nextCurrentScopeName = null;
          // Groups are keyed by session-STORE id, which is the workspace id
          // only for workspace scopes; global chat and each scheduled task
          // have their own sentinel store. Dedupe on the store id so the
          // current scope is never listed twice.
          const currentStoreId = scopeSessionStoreId(agentScope);
          const flattened: OtherWorkspaceSession[] = [];
          for (const group of allResult.groups) {
            if (group.workspaceId === currentStoreId) {
              nextCurrentScopeName = group.workspaceName;
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
          nextOtherSessions = flattened;
        }
      } else {
        nextOtherSessions = [];
      }

      // Commit the two halves together. Updating `sessions` before
      // `otherSessions` briefly duplicated the promoted session and rebuilt
      // the folder tree around the pointer.
      if (nextSessions) setSessions(nextSessions);
      if (nextOtherSessions) setOtherSessions(nextOtherSessions);
      if (nextCurrentScopeName !== undefined) {
        setCurrentScopeName(nextCurrentScopeName);
      }
      if (nextSessions || nextOtherSessions) {
        patchSessionsCache(scopeKey, {
          ...(nextSessions ? { sessions: nextSessions } : {}),
          ...(nextOtherSessions ? { otherSessions: nextOtherSessions } : {}),
        });
      }
    } finally {
      if (token === sessionListRequestRef.current) {
        setSessionsLoading(false);
      }
    }
  }, [agentScope, allWorkspaces, scopeKey, workspaceId]);

  useEffect(() => {
    // A selected session changes the main-side current pointer. Fetching the
    // list in parallel can observe the promotion halfway through and return
    // both its current and archived copies. Refresh only after that load has
    // settled and the caller clears skipInitialHistory.
    if (!eagerLoad || skipInitialHistory) return;
    void loadSessions();
  }, [eagerLoad, loadSessions, skipInitialHistory]);

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
    sessionListRequestRef.current += 1;
    setSessionsLoading(false);
    setSessionMenuOpen(false);
    setSessionError(null);
    // New-session is also a thread-pointer transition. Publish the busy state
    // before awaiting main so neither send nor another rail action can target
    // the old session while the durable pointer is moving.
    const token = ++threadRequestRef.current;
    setSessionLoading(true);
    try {
      const result = await window.canvasWorkspace.agent.newSession({ scope: agentScope });
      if (token !== threadRequestRef.current) return result;
      if (!result.ok) {
        setActiveSessionId(result.activeSessionId ?? null);
        setSessionError({
          code: result.code,
          message: result.error ?? t('chat.sessionNewFailed'),
        });
        return result;
      }
      setActiveSessionId(result.activeSessionId ?? null);
      onMessagesLoaded([]);
      return result;
    } catch (error) {
      const result = {
        ok: false,
        code: 'SESSION_MUTATION_FAILED',
        error: error instanceof Error ? error.message : String(error),
      };
      if (token === threadRequestRef.current) {
        setSessionError({ code: result.code, message: result.error });
      }
      return result;
    } finally {
      if (token === threadRequestRef.current) setSessionLoading(false);
    }
  }, [agentScope, onMessagesLoaded, t]);

  const handleLoadSession = useCallback(async (sessionId: string, sourceWorkspaceId?: string) => {
    setSessionMenuOpen(false);

    const crossWorkspace = !!(
      sourceWorkspaceId
      && workspaceId
      && sourceWorkspaceId !== workspaceId
    );
    return await runThreadFetch(
      () => (
        crossWorkspace
          ? window.canvasWorkspace.agent.loadCrossWorkspaceSession(workspaceId!, sourceWorkspaceId!, sessionId)
          : window.canvasWorkspace.agent.loadSession({ scope: agentScope }, sessionId)
      ),
      crossWorkspace ? undefined : sessionId,
    );
  }, [agentScope, runThreadFetch, workspaceId]);

  /**
   * Adopt a session that was created by another authoritative main-process
   * mutation (for example edit/regenerate branching). This keeps the
   * renderer's pointer and cached rail metadata aligned without issuing a
   * second competing load request.
   */
  const adoptActiveSession = useCallback((sessionId: string) => {
    sessionListRequestRef.current += 1;
    setSessionsLoading(false);
    threadRequestRef.current += 1;
    setSessionLoading(false);
    setActiveSessionId(sessionId);
    setSessions(previous => {
      const next = previous.map(session => ({
        ...session,
        isCurrent: session.sessionId === sessionId,
      }));
      patchSessionsCache(scopeKey, { sessions: next });
      return next;
    });
  }, [scopeKey]);

  const retrySession = useCallback(async () => {
    const retry = threadRetryRef.current;
    if (retry?.scopeKey === scopeKey) {
      await runThreadFetch(retry.fetchThread, retry.expectedSessionId);
      return;
    }
    await runThreadFetch(
      () => window.canvasWorkspace.agent.getHistory({ scope: agentScopeRef.current }),
    );
  }, [runThreadFetch, scopeKey]);

  const failSessionMutation = useCallback((result: {
    code?: string;
    error?: string;
  }, fallback: string): never => {
    const message = result.error ?? fallback;
    setSessionError({ code: result.code, message });
    throw new Error(message);
  }, []);

  const renameSession = useCallback(async (
    sessionId: string,
    title: string,
    scope: AgentScope = agentScope,
  ) => {
    setSessionError(null);
    const result = await window.canvasWorkspace.agent.renameSession(
      { scope },
      sessionId,
      title,
    );
    if (!result.ok) failSessionMutation(result, t('chat.sessionRenameFailed'));
    await loadSessions();
    return result;
  }, [agentScope, failSessionMutation, loadSessions, t]);

  const toggleSessionPinned = useCallback(async (
    sessionId: string,
    pinned: boolean,
    scope: AgentScope = agentScope,
  ) => {
    setSessionError(null);
    const result = await window.canvasWorkspace.agent.setSessionPinned(
      { scope },
      sessionId,
      pinned,
    );
    if (!result.ok) failSessionMutation(result, t('chat.sessionUpdateFailed'));
    await loadSessions();
    return result;
  }, [agentScope, failSessionMutation, loadSessions, t]);

  const deleteSession = useCallback(async (
    sessionId: string,
    scope: AgentScope = agentScope,
  ) => {
    setSessionError(null);
    const changesVisibleScope = (
      scopeSessionStoreId(scope) === scopeSessionStoreId(agentScope)
    );
    if (changesVisibleScope) sessionListRequestRef.current += 1;
    if (changesVisibleScope) setSessionsLoading(false);
    const token = changesVisibleScope ? ++threadRequestRef.current : null;
    if (changesVisibleScope) setSessionLoading(true);
    try {
      const result = await window.canvasWorkspace.agent.deleteSession({ scope }, sessionId);
      if (!result.ok) failSessionMutation(result, t('chat.sessionDeleteFailed'));

      if (
        changesVisibleScope
        && result.activeSessionId
        && result.messages
      ) {
        setActiveSessionId(result.activeSessionId);
        onMessagesLoaded(result.messages);
      }
      await loadSessions();
      return result;
    } finally {
      if (token !== null && token === threadRequestRef.current) {
        setSessionLoading(false);
      }
    }
  }, [agentScope, failSessionMutation, loadSessions, onMessagesLoaded, t]);

  return {
    adoptActiveSession,
    otherSessions,
    activeSessionId,
    currentScopeName,
    deleteSession,
    handleLoadSession,
    handleNewSession,
    loadSessions,
    closeSessionMenu,
    openSessionMenu,
    renameSession,
    retrySession,
    sessionMenuOpen,
    sessionMenuRef,
    sessions,
    sessionsLoading,
    sessionLoading,
    sessionError,
    toggleSessionPinned,
  };
}
