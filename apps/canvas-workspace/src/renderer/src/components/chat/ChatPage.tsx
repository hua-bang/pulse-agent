import { useCallback, useState } from 'react';
import type { CanvasNode } from '../../types';
import type { SettingsSection } from '../Settings';
import type { UnifiedSession } from './ChatSessionsRail';
import { ChatPageBody } from './ChatPageBody';
import type { AgentScope, WorkspaceOption } from './types';

interface ChatPageProps {
  allWorkspaces: WorkspaceOption[];
  getWorkspaceNodes?: (workspaceId: string) => CanvasNode[];
  getWorkspaceRootFolder?: (workspaceId: string) => string | undefined;
  onWorkspaceContextRequest?: (workspaceId: string) => void;
  onExit: () => void;
  onNodeFocus?: (workspaceId: string, nodeId: string) => void;
  /** Opens the global Settings drawer focused on the given section. */
  onOpenAppSettings: (section: SettingsSection) => void;
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
  getWorkspaceNodes,
  getWorkspaceRootFolder,
  onWorkspaceContextRequest,
  onExit,
  onNodeFocus,
  onOpenAppSettings,
}: ChatPageProps) => {
  const [agentScope, setAgentScope] = useState<AgentScope>({ kind: 'global' });
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [newSessionRequest, setNewSessionRequest] = useState(0);
  const [railCollapsed, setRailCollapsed] = useState(true);
  const scopeKey = agentScope.kind === 'global' ? 'global' : `workspace:${agentScope.workspaceId}`;

  // Same-workspace session click → just bump pendingSessionId without
  // remounting the body. Cross-workspace click → change workspaceId which
  // triggers the body remount, and the new body mount effect will pick up
  // initialPendingSessionId.
  const handleSelectSession = useCallback((session: UnifiedSession) => {
    const nextScope: AgentScope = session.workspaceId === '__global_chat__'
      ? { kind: 'global' }
      : { kind: 'workspace', workspaceId: session.workspaceId };
    const nextScopeKey = nextScope.kind === 'global' ? 'global' : `workspace:${nextScope.workspaceId}`;
    if (nextScopeKey === scopeKey) {
      setPendingSessionId(session.sessionId);
      return;
    }
    setAgentScope(nextScope);
    setPendingSessionId(session.sessionId);
  }, [scopeKey]);

  const handleNewGlobalSession = useCallback(() => {
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
    />
  );
};
