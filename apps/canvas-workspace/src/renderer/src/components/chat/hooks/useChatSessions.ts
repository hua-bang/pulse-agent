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
  // Detail counterpart of sessionsLoading: true while THIS session's messages
  // are in flight. Both thread fetches — the mount/scope-change getHistory
  // below and handleLoadSession — used to run with no pending state at all,
  // so for the whole IPC round trip the view either kept the previous
  // session's messages on screen or (after a scope remount, where the thread
  // starts empty) fell through to the empty state. Seeded true because a
  // fetch is always imminent at mount: either the history effect runs, or
  // skipInitialHistory promised a handleLoadSession call.
  const [sessionLoading, setSessionLoading] = useState(true);
  // Monotonic token for thread fetches. Only the newest fetch may write to
  // the thread or clear the flag — two quick session picks (or a pick landing
  // while the mount history fetch is still open) would otherwise let the
  // slower response overwrite the session the user actually asked for.
  const threadRequestRef = useRef(0);
  // The token alone is NOT enough for session SWITCHES. loadSession /
  // loadCrossWorkspaceSession / newSession are state-changing main-side —
  // SessionStore archives the current session and promotes the requested one
  // — so two overlapping switches leave the main-side pointer at whichever
  // call finishes last, while the token paints whichever was clicked last.
  // Those two can disagree, and then the next turn persists into a
  // conversation the user is not looking at. Refusing an overlapping switch
  // is what keeps the pointer and the thread in agreement; the token stays as
  // the renderer-side arbiter for the one overlap still allowed. getHistory
  // is deliberately exempt: it activates and reads, never promotes, so a pick
  // may overlap the mount history fetch harmlessly.
  const switchInFlightRef = useRef(false);
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
  /**
   * Runs a thread-replacing fetch behind `sessionLoading`, dropping the result
   * of any fetch that a newer one has already superseded.
   */
  const runThreadFetch = useCallback(async (fetchThread: () => Promise<ThreadFetchResult>) => {
    const token = ++threadRequestRef.current;
    setSessionLoading(true);
    try {
      const result = await fetchThread();
      // A newer fetch (or a new-session reset) took over while this one was
      // open: neither its messages nor its "done" belong to what's on screen.
      if (token !== threadRequestRef.current) return;
      if (result.ok && result.messages) {
        onMessagesLoaded(result.messages);
      }
    } finally {
      if (token === threadRequestRef.current) {
        setSessionLoading(false);
      }
    }
  }, [onMessagesLoaded]);

  useEffect(() => {
    // The caller is about to run its own handleLoadSession; leave
    // sessionLoading seeded true so the thread stays in its loading state
    // continuously instead of flashing empty between the two.
    if (skipInitialHistory) return;
    void runThreadFetch(() => window.canvasWorkspace.agent.getHistory({ scope: agentScopeRef.current }));
  }, [runThreadFetch, skipInitialHistory, scopeKey]);

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
    if (switchInFlightRef.current) return { ok: false };
    switchInFlightRef.current = true;
    try {
      const result = await window.canvasWorkspace.agent.newSession({ scope: agentScope });
      if (!result.ok) return result;
      // Retire any in-flight thread fetch: its messages belong to the session
      // we just navigated away from, and a blank new chat is not "loading".
      threadRequestRef.current += 1;
      setSessionLoading(false);
      onMessagesLoaded([]);
      return result;
    } finally {
      switchInFlightRef.current = false;
    }
  }, [agentScope, onMessagesLoaded]);

  const handleLoadSession = useCallback(async (sessionId: string, sourceWorkspaceId?: string) => {
    setSessionMenuOpen(false);
    if (switchInFlightRef.current) return;
    switchInFlightRef.current = true;
    try {
      await runThreadFetch(() => (
        sourceWorkspaceId && workspaceId && sourceWorkspaceId !== workspaceId
          ? window.canvasWorkspace.agent.loadCrossWorkspaceSession(workspaceId, sourceWorkspaceId, sessionId)
          : window.canvasWorkspace.agent.loadSession({ scope: agentScope }, sessionId)
      ));
    } finally {
      switchInFlightRef.current = false;
    }
  }, [agentScope, runThreadFetch, workspaceId]);

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
    sessionLoading,
  };
}
