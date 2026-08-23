import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AgentChatMessage, AgentSessionInfo } from '../../../types';
import type { AgentScope, OtherWorkspaceSession, WorkspaceOption } from '../types';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { scopeSessionStoreId } from '../../../../../shared/agent-chat';
import { useI18n } from '../../../i18n';
import {
  beginChatConversationMutation,
  createChatConversationMutationState,
  finishChatConversationMutation,
  invalidateChatConversationMutation,
  type ChatConversationMutationRef,
} from './chatConversationMutation';
import { partitionSessionGroups } from './sessionListGroups';
import { deliverLoadedConversation, type LoadedConversation } from './loadedConversationSink';
import { useLiveSessionLists } from './useLiveSessionLists';
interface UseChatSessionsOptions {
  agentScope: AgentScope;
  allWorkspaces?: WorkspaceOption[];
  onMessagesLoaded?: (messages: AgentChatMessage[]) => void;
  onConversationLoaded?: (loaded: LoadedConversation) => void;
  onConversationLoadStart?: (scope: AgentScope) => ReadonlyMap<string, number>;
  /** When true, load the session list on mount and whenever workspaceId changes. */
  eagerLoad?: boolean;
  /** Skip mount history when the caller will load a session; that load must clear `sessionLoading`. */
  skipInitialHistory?: boolean;
  conversationMutationRef?: ChatConversationMutationRef;
  onConversationMutationStart?: () => void;
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

export const resetChatSessionsCacheForTests = (): void => {
  sessionsCache.clear();
};
function patchSessionsCache(key: string, patch: Partial<CachedSessions>): void {
  const prev = sessionsCache.get(key) ?? { sessions: [], otherSessions: [] };
  // Delete-then-set marks the key most recently used.
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
  onConversationLoaded,
  onConversationLoadStart,
  eagerLoad = false,
  skipInitialHistory = false,
  conversationMutationRef,
  onConversationMutationStart,
}: UseChatSessionsOptions) {
  const { t } = useI18n();
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const scopeKey = agentScope.kind === 'workspace'
    ? `workspace:${agentScope.workspaceId}`
    : agentScope.kind === 'scheduled'
      ? `scheduled:${agentScope.taskId}`
      : 'global';

  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [sessions, setSessions] = useState<AgentSessionInfo[]>(
    () => sessionsCache.get(scopeKey)?.sessions ?? [],
  );
  const [otherSessions, setOtherSessions] = useState<OtherWorkspaceSession[]>(
    () => sessionsCache.get(scopeKey)?.otherSessions ?? [],
  );
  const [sessionsStoreId, setSessionsStoreId] = useState(
    () => scopeSessionStoreId(agentScope),
  );
  const [currentScopeName, setCurrentScopeName] = useState<string | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(
    () => eagerLoad && !sessionsCache.has(scopeKey),
  );
  const [sessionLoading, setSessionLoading] = useState(true);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<{
    code?: string;
    message: string;
  } | null>(null);
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
  const localConversationMutationRef = useRef(createChatConversationMutationState());
  const mutationRef = conversationMutationRef ?? localConversationMutationRef;
  const visibleSessionLists = useLiveSessionLists({
    agentScope, allWorkspaces, activeSessionId, sessions, otherSessions,
  });

  useLayoutEffect(() => {
    if (previousScopeKeyRef.current === scopeKey) return;
    invalidateChatConversationMutation(mutationRef);
    onConversationMutationStart?.();
    sessionListRequestRef.current += 1;
    threadRequestRef.current += 1;
    onMessagesLoaded?.([]);
    setSessionsLoading(eagerLoad);
    // Block sends before the next scope's pointer fetch starts.
    setSessionLoading(true);
    setSessionError(null);
    setActiveSessionId(null);
    setSessionMenuOpen(false);
    previousScopeKeyRef.current = scopeKey;
  }, [eagerLoad, mutationRef, onConversationMutationStart, onMessagesLoaded, scopeKey]);

  useLayoutEffect(() => {
    if (!skipInitialHistory) return;
    sessionListRequestRef.current += 1;
    setSessionsLoading(true);
  }, [skipInitialHistory]);

  const agentScopeRef = useRef(agentScope);
  agentScopeRef.current = agentScope;

  // Reload history only when the scope changes. Key on the stable `scopeKey`,
  // not the `agentScope` object (recreated each render would re-fire this
  // effect and clobber the in-flight stream).
  const runThreadFetch = useCallback(async (
    fetchThread: () => Promise<ThreadFetchResult>,
    expectedSessionId?: string,
  ) => {
    const expectedSequences = onConversationLoadStart?.(agentScopeRef.current);
    const mutationGeneration = beginChatConversationMutation(mutationRef, onConversationMutationStart);
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
        const sessionId = result.activeSessionId ?? expectedSessionId;
        deliverLoadedConversation({ scope: agentScopeRef.current, sessionId, messages: result.messages, expectedSequence: sessionId && expectedSequences ? expectedSequences.get(sessionId) ?? 0 : undefined, onMessagesLoaded, onConversationLoaded });
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
      finishChatConversationMutation(mutationRef, mutationGeneration);
      if (token === threadRequestRef.current) {
        setSessionLoading(false);
      }
    }
  }, [mutationRef, onConversationLoaded, onConversationLoadStart, onConversationMutationStart, onMessagesLoaded, scopeKey, t]);

  useEffect(() => {
    // Keep the loading state continuous until the caller loads its session.
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
      const currentStoreId = scopeSessionStoreId(agentScope);
      const workspaceNameMap: Record<string, string> = {};
      for (const workspace of allWorkspaces ?? []) {
        workspaceNameMap[workspace.id] = workspace.name;
      }
      // The all-sessions response already contains the current scope. Asking
      // for both APIs made the full-page rail scan that store redundantly and
      // then reconcile two snapshots from the same mutation boundary.
      const result = allWorkspaces
        ? null
        : await window.canvasWorkspace.agent.listSessions({ scope: agentScope });
      const allResult = allWorkspaces
        ? await window.canvasWorkspace.agent.listAllSessions(workspaceNameMap)
        : null;
      if (token !== sessionListRequestRef.current) return;
      let nextSessions: AgentSessionInfo[] | undefined;
      let nextOtherSessions: OtherWorkspaceSession[] | undefined;
      let nextCurrentScopeName: string | null | undefined;

      if (result?.ok && result.sessions) {
        nextSessions = result.sessions;
        const listedCurrent = result.sessions.find(session => session.isCurrent);
        // An empty current pointer is intentionally omitted from history. Do
        // not erase the live pointer just because the list has no listable
        // current row while a new chat is being composed.
        if (listedCurrent) setActiveSessionId(listedCurrent.sessionId);
      }

      if (allResult) {
        if (allResult.ok && allResult.groups) {
          const partitioned = partitionSessionGroups(allResult.groups, currentStoreId);
          nextSessions = partitioned.sessions;
          nextOtherSessions = partitioned.otherSessions;
          nextCurrentScopeName = partitioned.currentScopeName;
          const listedCurrent = nextSessions.find(session => session.isCurrent);
          if (listedCurrent) setActiveSessionId(listedCurrent.sessionId);
        }
      } else {
        nextOtherSessions = [];
      }

      // Commit the two halves together. Updating `sessions` before
      // `otherSessions` briefly duplicated the promoted session and rebuilt
      // the folder tree around the pointer.
      if (nextSessions) {
        setSessions(nextSessions);
        setSessionsStoreId(scopeSessionStoreId(agentScope));
      }
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
    } catch {
      // Best-effort refresh; never surface an unhandled rejection.
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
    const mutationGeneration = beginChatConversationMutation(mutationRef, onConversationMutationStart);
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
      deliverLoadedConversation({ scope: agentScope, sessionId: result.activeSessionId, messages: [], onMessagesLoaded, onConversationLoaded });
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
      finishChatConversationMutation(mutationRef, mutationGeneration);
      if (token === threadRequestRef.current) setSessionLoading(false);
    }
  }, [agentScope, mutationRef, onConversationLoaded, onConversationMutationStart, onMessagesLoaded, t]);

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

  /** Adopt the session created by an authoritative main-process branch mutation. */
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
    const mutationGeneration = changesVisibleScope
      ? beginChatConversationMutation(mutationRef, onConversationMutationStart)
      : null;
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
        deliverLoadedConversation({ scope, sessionId: result.activeSessionId, messages: result.messages, onMessagesLoaded, onConversationLoaded });
      }
      await loadSessions();
      return result;
    } finally {
      if (mutationGeneration !== null) finishChatConversationMutation(mutationRef, mutationGeneration);
      if (token !== null && token === threadRequestRef.current) {
        setSessionLoading(false);
      }
    }
  }, [agentScope, failSessionMutation, loadSessions, mutationRef, onConversationLoaded, onConversationMutationStart, onMessagesLoaded, t]);

  return {
    adoptActiveSession,
    otherSessions: visibleSessionLists.otherSessions,
    sessionsStoreId,
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
    sessions: visibleSessionLists.sessions,
    sessionsLoading,
    sessionLoading,
    sessionError,
    toggleSessionPinned,
  };
}
