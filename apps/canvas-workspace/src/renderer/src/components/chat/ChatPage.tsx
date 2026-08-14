import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasNode } from '../../types';
import type { SettingsSection } from '../settings/Settings';
import type { UnifiedSession } from './ChatSessionsRail';
import { ChatPageBody } from './ChatPageBody';
import type { SessionBackEntry } from './SessionBackBar';
import type { AgentNewSessionResult, AgentScope, WorkspaceOption } from './types';
import {
  GLOBAL_CHAT_STORE_ID,
  scheduledTaskIdFromStoreId,
  scopeSessionStoreId,
} from '../../../../shared/agent-chat';
import type {
  ChatContextSnapshot,
  ChatExecutionPolicy,
  ChatTarget,
} from './ChatTargetContext';

const workspaceIdFromScope = (scope: AgentScope): string | null =>
  scope.kind === 'workspace' ? scope.workspaceId : null;

interface ChatPageProps {
  allWorkspaces: WorkspaceOption[];
  /** Scheduled task whose chat should be opened on entry (route query). */
  openScheduledTaskId?: string | null;
  /** Visible chat target that opened this full-page surface. */
  initialTarget?: ChatTarget | null;
  getWorkspaceNodes?: (workspaceId: string) => CanvasNode[];
  getWorkspaceRootFolder?: (workspaceId: string) => string | undefined;
  onWorkspaceContextRequest?: (workspaceId: string) => void;
  /** Reports the workspace that owns the visible conversation. Global and
   * scheduled conversations report null. */
  onWorkspaceScopeChange?: (workspaceId: string | null) => void;
  onExit: () => void;
  onNodeFocus?: (workspaceId: string, nodeId: string) => void;
  /** Opens the global Settings drawer focused on the given section. */
  onOpenAppSettings: (section: SettingsSection) => void;
}

/**
 * Full-screen AI Chat page. Decoupled from the app-level activeId — the
 * default page is global / unbound. A new chat can explicitly choose a
 * workspace, while the top-right plus inherits the active workspace when one
 * is already selected.
 *
 * Structure:
 *   - Outer ChatPage: owns currentWorkspaceId + pendingSessionId state.
 *   - Inner ChatPageBody: stays mounted across scope changes. Its hooks switch
 *     subscriptions and cached state in place, so selecting another workspace
 *     does not recreate the whole chat surface.
 *
 * Mutual exclusion with ChatPanel is enforced at the App level.
 */
export const ChatPage = ({
  allWorkspaces,
  openScheduledTaskId,
  initialTarget,
  getWorkspaceNodes,
  getWorkspaceRootFolder,
  onWorkspaceContextRequest,
  onWorkspaceScopeChange,
  onExit,
  onNodeFocus,
  onOpenAppSettings,
}: ChatPageProps) => {
  const [agentScope, setAgentScope] = useState<AgentScope>(
    () => initialTarget?.scope ?? { kind: 'global' },
  );
  const [pendingSessionIntent, setPendingSessionIntent] = useState<{
    id: number;
    sessionId: string;
  } | null>(
    () => initialTarget?.sessionId ? { id: 1, sessionId: initialTarget.sessionId } : null,
  );
  const sessionIntentSequenceRef = useRef(initialTarget?.sessionId ? 1 : 0);
  const pendingSessionIntentRef = useRef<number | null>(initialTarget?.sessionId ? 1 : null);
  const pendingSessionId = pendingSessionIntent?.sessionId ?? null;
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(
    () => initialTarget?.sessionId
      ? `${initialTarget.scopeId}:${initialTarget.sessionId}`
      : null,
  );
  const [contextSnapshot, setContextSnapshot] = useState<ChatContextSnapshot | undefined>(
    () => initialTarget?.contextSnapshot,
  );
  const [executionPolicy, setExecutionPolicy] = useState<ChatExecutionPolicy>(
    () => initialTarget?.executionPolicy ?? 'auto',
  );
  const scopeRollbackRef = useRef<{
    agentScope: AgentScope;
    selectedSessionKey: string | null;
    contextSnapshot?: ChatContextSnapshot;
    executionPolicy: ChatExecutionPolicy;
    sessionBackStack: SessionBackEntry[];
  } | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(true);
  // Jump trail for session-ref chip navigation. Owned here so scope changes
  // and thread replacement cannot disturb it.
  const [sessionBackStack, setSessionBackStack] = useState<SessionBackEntry[]>([]);
  const scopeKey = scopeSessionStoreId(agentScope);

  useEffect(() => {
    onWorkspaceScopeChange?.(workspaceIdFromScope(agentScope));
  }, [agentScope, onWorkspaceScopeChange]);

  // Entry from the run-finished toast: land on the task's own conversation
  // in this page's rail rather than a separate full-page route.
  useEffect(() => {
    if (!openScheduledTaskId) return;
    scopeRollbackRef.current = null;
    pendingSessionIntentRef.current = null;
    sessionIntentSequenceRef.current += 1;
    setAgentScope({ kind: 'scheduled', taskId: openScheduledTaskId });
    setPendingSessionIntent(null);
    setSelectedSessionKey(null);
    setContextSnapshot(undefined);
    setExecutionPolicy('scheduled');
    setSessionBackStack([]);
  }, [openScheduledTaskId]);

  // Every session click keeps the body mounted. Cross-scope picks update the
  // scope and pending session together; the body swaps thread data in place.
  const navigateToSession = useCallback((session: { sessionId: string; workspaceId: string }) => {
    const intentId = ++sessionIntentSequenceRef.current;
    pendingSessionIntentRef.current = intentId;
    setPendingSessionIntent({ id: intentId, sessionId: session.sessionId });
    setSelectedSessionKey(`${session.workspaceId}:${session.sessionId}`);
    // The rail's `workspaceId` is really a session-STORE id, so the two
    // sentinel stores (global chat, one per scheduled task) must map back to
    // their own scope kinds — treating them as workspace ids would activate
    // an agent against a workspace that does not exist.
    const scheduledTaskId = scheduledTaskIdFromStoreId(session.workspaceId);
    const nextScope: AgentScope = scheduledTaskId
      ? { kind: 'scheduled', taskId: scheduledTaskId }
      : session.workspaceId === GLOBAL_CHAT_STORE_ID
        ? { kind: 'global' }
        : { kind: 'workspace', workspaceId: session.workspaceId };
    const nextScopeKey = scopeSessionStoreId(nextScope);
    onWorkspaceScopeChange?.(workspaceIdFromScope(nextScope));
    scopeRollbackRef.current ??= {
      agentScope, selectedSessionKey, contextSnapshot, executionPolicy, sessionBackStack,
    };
    setContextSnapshot(undefined);
    setExecutionPolicy(nextScope.kind === 'scheduled' ? 'scheduled' : 'auto');
    if (nextScopeKey === scopeKey) {
      return;
    }
    setAgentScope(nextScope);
  }, [agentScope, contextSnapshot, executionPolicy, onWorkspaceScopeChange, scopeKey, selectedSessionKey, sessionBackStack]);

  // Manual rail pick resets the jump trail; chip jumps (onJumpToSession)
  // keep it so the back bar can walk home.
  const handleSelectSession = useCallback((session: UnifiedSession) => {
    setSessionBackStack([]);
    setContextSnapshot(undefined);
    setExecutionPolicy(scheduledTaskIdFromStoreId(session.workspaceId) ? 'scheduled' : 'auto');
    navigateToSession(session);
  }, [navigateToSession]);

  const handlePushBackEntry = useCallback((entry: SessionBackEntry) => {
    setSessionBackStack((prev) => [...prev, entry]);
  }, []);

  const handleBackToSession = useCallback(() => {
    const entry = sessionBackStack[sessionBackStack.length - 1];
    if (!entry) return;
    setSessionBackStack((prev) => prev.slice(0, -1));
    navigateToSession({ sessionId: entry.sessionId, workspaceId: entry.workspaceId });
  }, [navigateToSession, sessionBackStack]);

  const handleClearBackStack = useCallback(() => {
    setSessionBackStack([]);
  }, []);

  const handleNewSessionCreated = useCallback((scope: AgentScope) => {
    setContextSnapshot(undefined);
    setExecutionPolicy(scope.kind === 'scheduled' ? 'scheduled' : 'auto');
    setSessionBackStack([]);
    scopeRollbackRef.current = null;
  }, []);

  const handleCreateNewSessionInScope = useCallback(async (
    scope: AgentScope,
  ): Promise<AgentNewSessionResult> => {
    let result: AgentNewSessionResult;
    try {
      result = await window.canvasWorkspace.agent.newSession({ scope });
    } catch (error) {
      return {
        ok: false,
        code: 'SESSION_MUTATION_FAILED',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (!result.ok) return result;
    if (!result.activeSessionId) {
      return {
        ok: false,
        code: 'SESSION_ACK_MISMATCH',
      };
    }

    const intentId = ++sessionIntentSequenceRef.current;
    pendingSessionIntentRef.current = intentId;
    setPendingSessionIntent({ id: intentId, sessionId: result.activeSessionId });
    setSelectedSessionKey(`${scopeSessionStoreId(scope)}:${result.activeSessionId}`);
    onWorkspaceScopeChange?.(workspaceIdFromScope(scope));
    setAgentScope(scope);
    return result;
  }, [onWorkspaceScopeChange]);

  const handleSessionConsumed = useCallback((intentId: number, loaded: boolean) => {
    if (pendingSessionIntentRef.current !== intentId) return;
    pendingSessionIntentRef.current = null;
    setPendingSessionIntent(null);
    const rollback = scopeRollbackRef.current;
    scopeRollbackRef.current = null;
    if (loaded || !rollback) return;
    onWorkspaceScopeChange?.(workspaceIdFromScope(rollback.agentScope));
    setAgentScope(rollback.agentScope);
    setSelectedSessionKey(rollback.selectedSessionKey);
    setContextSnapshot(rollback.contextSnapshot);
    setExecutionPolicy(rollback.executionPolicy);
    setSessionBackStack(rollback.sessionBackStack);
  }, [onWorkspaceScopeChange]);
  const handleActiveSessionResolved = useCallback((sessionId: string, workspaceId: string) => {
    setSelectedSessionKey(`${workspaceId}:${sessionId}`);
  }, []);

  const handleToggleRail = useCallback(() => {
    setRailCollapsed((v) => !v);
  }, []);

  const workspaceId = workspaceIdFromScope(agentScope) ?? undefined;
  const nodes = workspaceId ? getWorkspaceNodes?.(workspaceId) : undefined;
  const rootFolder = workspaceId ? getWorkspaceRootFolder?.(workspaceId) : undefined;

  return (
    <ChatPageBody
      agentScope={agentScope}
      contextSnapshot={contextSnapshot}
      executionPolicy={executionPolicy}
      initialPendingSessionId={pendingSessionId}
      pendingSessionId={pendingSessionId}
      pendingSessionIntentId={pendingSessionIntent?.id ?? null}
      selectedSessionKey={selectedSessionKey}
      onSessionConsumed={handleSessionConsumed}
      onCreateNewSessionInScope={handleCreateNewSessionInScope}
      onNewSessionCreated={handleNewSessionCreated}
      onActiveSessionResolved={handleActiveSessionResolved}
      onSelectSession={handleSelectSession}
      onJumpToSession={navigateToSession}
      backEntry={sessionBackStack[sessionBackStack.length - 1] ?? null}
      onPushBackEntry={handlePushBackEntry}
      onBackToSession={handleBackToSession}
      onClearBackStack={handleClearBackStack}
      onWorkspaceContextRequest={onWorkspaceContextRequest}
      allWorkspaces={allWorkspaces}
      nodes={nodes}
      rootFolder={rootFolder}
      onExit={onExit}
      onNodeFocus={onNodeFocus}
      railCollapsed={railCollapsed}
      onToggleRail={handleToggleRail}
      onOpenAppSettings={onOpenAppSettings}
    />
  );
};
