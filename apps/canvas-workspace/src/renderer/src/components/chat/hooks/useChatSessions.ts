import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentChatMessage, AgentSessionInfo } from '../../../types';
import type { AgentScope, OtherWorkspaceSession, WorkspaceOption } from '../types';

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

export function useChatSessions({
  agentScope,
  allWorkspaces,
  onMessagesLoaded,
  eagerLoad = false,
  skipInitialHistory = false,
}: UseChatSessionsOptions) {
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([]);
  const [otherSessions, setOtherSessions] = useState<OtherWorkspaceSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const sessionMenuRef = useRef<HTMLDivElement>(null);
  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const scopeKey = agentScope.kind === 'global' ? 'global' : `workspace:${agentScope.workspaceId}`;

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

  useEffect(() => {
    if (!sessionMenuOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      if (sessionMenuRef.current && !sessionMenuRef.current.contains(event.target as Node)) {
        setSessionMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [sessionMenuOpen]);

  const loadSessions = useCallback(async () => {
      setSessionsLoading(true);
      try {
      const result = await window.canvasWorkspace.agent.listSessions({ scope: agentScope });
      if (result.ok && result.sessions) {
        setSessions(result.sessions);
      }

      if (allWorkspaces && (agentScope.kind === 'global' || allWorkspaces.length > 1)) {
        const workspaceNameMap: Record<string, string> = {};
        for (const workspace of allWorkspaces) {
          workspaceNameMap[workspace.id] = workspace.name;
        }

        const allResult = await window.canvasWorkspace.agent.listAllSessions(workspaceNameMap);
        if (allResult.ok && allResult.groups) {
          const flattened: OtherWorkspaceSession[] = [];
          for (const group of allResult.groups) {
            if (workspaceId && group.workspaceId === workspaceId) continue;
            if (agentScope.kind === 'global' && group.workspaceId === '__global_chat__') continue;
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
        }
      } else {
        setOtherSessions([]);
      }
    } finally {
      setSessionsLoading(false);
    }
  }, [agentScope, allWorkspaces, workspaceId]);

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
    await window.canvasWorkspace.agent.newSession({ scope: agentScope });
    onMessagesLoaded([]);
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
    handleLoadSession,
    handleNewSession,
    loadSessions,
    openSessionMenu,
    sessionMenuOpen,
    sessionMenuRef,
    sessions,
    sessionsLoading,
  };
}
