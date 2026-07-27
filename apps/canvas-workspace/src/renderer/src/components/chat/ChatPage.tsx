import { useCallback, useEffect, useState } from 'react';
import type { CanvasNode } from '../../types';
import type { SettingsSection } from '../Settings';
import type { UnifiedSession } from './ChatSessionsRail';
import { ChatPageBody } from './ChatPageBody';
import type { SessionBackEntry } from './SessionBackBar';
import type { AgentScope, WorkspaceOption } from './types';
import { scheduledTaskIdFromStoreId } from '../../../../shared/agent-chat';

interface ChatPageProps {
  allWorkspaces: WorkspaceOption[];
  /** Scheduled task whose chat should be opened on entry (route query). */
  openScheduledTaskId?: string | null;
  getWorkspaceNodes?: (workspaceId: string) => CanvasNode[];
  getWorkspaceRootFolder?: (workspaceId: string) => string | undefined;
  onWorkspaceContextRequest?: (workspaceId: string) => void;
  onExit: () => void;
  onNodeFocus?: (workspaceId: string, nodeId: string) => void;
  /** Opens the global Settings drawer focused on the given section. */
  onOpenAppSettings: (section: SettingsSection) => void;
  /** Opens per-workspace settings when the chat scope is workspace-bound. */
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
}

/**
 * Full-screen AI Chat page. Decoupled from the app-level activeId — the
 * default page is global / unbound. Workspace is only entered when the user
 * selects a workspace-owned historical session.
 *
 * Structure:
 *   - Outer ChatPage: owns currentWorkspaceId + pendingSessionId state.
 *     Remounts the inner body (React key) when the workspace changes so the
 *     hook subscriptions are rebuilt cleanly against the new workspace.
 *   - Inner ChatPageBody: owns the streaming / session / mention hooks. On
 *     mount, loads `initialPendingSessionId` if provided (used when the
 *     user picked a cross-workspace session in the rail).
 *
 * Mutual exclusion with ChatPanel is enforced at the App level.
 */
export const ChatPage = ({
  allWorkspaces,
  openScheduledTaskId,
  getWorkspaceNodes,
  getWorkspaceRootFolder,
  onWorkspaceContextRequest,
  onExit,
  onNodeFocus,
  onOpenAppSettings,
  onOpenWorkspaceSettings,
}: ChatPageProps) => {
  const [agentScope, setAgentScope] = useState<AgentScope>({ kind: 'global' });
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [newSessionRequest, setNewSessionRequest] = useState(0);
  const [railCollapsed, setRailCollapsed] = useState(true);
  const scopeKey = agentScope.kind === 'workspace'
    ? `workspace:${agentScope.workspaceId}`
    : agentScope.kind === 'scheduled'
      ? `scheduled:${agentScope.taskId}`
      : 'global';

  // Entry from the run-finished toast: land on the task's own conversation
  // in this page's rail rather than a separate full-page route.
  useEffect(() => {
    if (!openScheduledTaskId) return;
    setAgentScope({ kind: 'scheduled', taskId: openScheduledTaskId });
    setPendingSessionId(null);
  }, [openScheduledTaskId]);

  // Jump trail for session-ref chip navigation. Owned here (not in the body)
  // so it survives the body remount a cross-workspace jump triggers.
  const [sessionBackStack, setSessionBackStack] = useState<SessionBackEntry[]>([]);

  // Same-workspace session click → just bump pendingSessionId without
  // remounting the body. Cross-workspace click → change workspaceId which
  // triggers the body remount, and the new body mount effect will pick up
  // initialPendingSessionId.
  const navigateToSession = useCallback((session: { sessionId: string; workspaceId: string }) => {
    // The rail's `workspaceId` is really a session-STORE id, so the two
    // sentinel stores (global chat, one per scheduled task) must map back to
    // their own scope kinds — treating them as workspace ids would activate
    // an agent against a workspace that does not exist.
    const scheduledTaskId = scheduledTaskIdFromStoreId(session.workspaceId);
    const nextScope: AgentScope = scheduledTaskId
      ? { kind: 'scheduled', taskId: scheduledTaskId }
      : session.workspaceId === '__global_chat__'
        ? { kind: 'global' }
        : { kind: 'workspace', workspaceId: session.workspaceId };
    const nextScopeKey = nextScope.kind === 'global'
      ? 'global'
      : nextScope.kind === 'scheduled'
        ? `scheduled:${nextScope.taskId}`
        : `workspace:${nextScope.workspaceId}`;
    if (nextScopeKey === scopeKey) {
      setPendingSessionId(session.sessionId);
      return;
    }
    setAgentScope(nextScope);
    setPendingSessionId(session.sessionId);
  }, [scopeKey]);

  // Manual rail pick resets the jump trail; chip jumps (onJumpToSession)
  // keep it so the back bar can walk home.
  const handleSelectSession = useCallback((session: UnifiedSession) => {
    setSessionBackStack([]);
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

  const handleNewGlobalSession = useCallback(() => {
    setSessionBackStack([]);
    setAgentScope({ kind: 'global' });
    setPendingSessionId(null);
    setNewSessionRequest((value) => value + 1);
  }, []);

  const handleSessionConsumed = useCallback(() => {
    setPendingSessionId(null);
  }, []);

  const handleToggleRail = useCallback(() => {
    setRailCollapsed((v) => !v);
  }, []);

  const workspaceId = agentScope.kind === 'workspace' ? agentScope.workspaceId : undefined;
  const nodes = workspaceId ? getWorkspaceNodes?.(workspaceId) : undefined;
  const rootFolder = workspaceId ? getWorkspaceRootFolder?.(workspaceId) : undefined;

  return (
    <ChatPageBody
      key={scopeKey}
      agentScope={agentScope}
      initialPendingSessionId={pendingSessionId}
      pendingSessionId={pendingSessionId}
      onSessionConsumed={handleSessionConsumed}
      onSelectSession={handleSelectSession}
      onJumpToSession={navigateToSession}
      backEntry={sessionBackStack[sessionBackStack.length - 1] ?? null}
      onPushBackEntry={handlePushBackEntry}
      onBackToSession={handleBackToSession}
      onClearBackStack={handleClearBackStack}
      onNewGlobalSession={handleNewGlobalSession}
      newSessionRequest={newSessionRequest}
      onWorkspaceContextRequest={onWorkspaceContextRequest}
      allWorkspaces={allWorkspaces}
      nodes={nodes}
      rootFolder={rootFolder}
      onExit={onExit}
      onNodeFocus={onNodeFocus}
      railCollapsed={railCollapsed}
      onToggleRail={handleToggleRail}
      onOpenAppSettings={onOpenAppSettings}
      onOpenWorkspaceSettings={onOpenWorkspaceSettings}
    />
  );
};
