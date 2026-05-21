import { useCallback, useState } from 'react';
import type { CanvasNode } from '../../types';
import type { UnifiedSession } from './ChatSessionsRail';
import { ChatPageBody } from './ChatPageBody';
import { GLOBAL_WORKSPACE_ID } from './constants';
import type { WorkspaceOption } from './types';

interface ChatPageProps {
  /**
   * Initial workspace binding for the chat. `null` means "unbound" — the
   * chat opens without a canvas attached and the user can pick one via the
   * topbar chip or by clicking a session that belongs to a real workspace.
   * The chat page tracks its own current-workspace state internally after
   * mount — it does NOT stay in sync with the app-level activeId.
   */
  initialWorkspaceId: string | null;
  allWorkspaces: WorkspaceOption[];
  getWorkspaceNodes?: (workspaceId: string) => CanvasNode[];
  getWorkspaceRootFolder?: (workspaceId: string) => string | undefined;
  onWorkspaceContextRequest?: (workspaceId: string) => void;
  onExit: () => void;
  onNodeFocus?: (workspaceId: string, nodeId: string) => void;
}

/**
 * Full-screen AI Chat page. Decoupled from the app-level activeId — the
 * page treats sessions as the primary unit and supports an explicit
 * "unbound" state (workspaceId = null) where chat works without any
 * canvas context. The user can bind a workspace via the topbar chip or by
 * clicking a session that belongs to one.
 *
 * Structure:
 *   - Outer ChatPage: owns currentWorkspaceId + pendingSessionId state.
 *     Remounts the inner body (React key) when the workspace changes so the
 *     hook subscriptions are rebuilt cleanly against the new workspace.
 *   - Inner ChatPageBody: owns the streaming / session / mention hooks. On
 *     mount, loads `initialPendingSessionId` if provided (used when the
 *     user picked a cross-workspace session in the rail). Internally
 *     resolves `workspaceId ?? GLOBAL_WORKSPACE_ID` so every downstream
 *     hook still works with a plain string.
 *
 * Mutual exclusion with ChatPanel is enforced at the App level.
 */
export const ChatPage = ({
  initialWorkspaceId,
  allWorkspaces,
  getWorkspaceNodes,
  getWorkspaceRootFolder,
  onWorkspaceContextRequest,
  onExit,
  onNodeFocus,
}: ChatPageProps) => {
  const [workspaceId, setWorkspaceId] = useState<string | null>(initialWorkspaceId);
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(true);

  // Same-workspace session click → just bump pendingSessionId without
  // remounting the body. Cross-workspace click → change workspaceId which
  // triggers the body remount, and the new body mount effect will pick up
  // initialPendingSessionId.
  //
  // Sessions belonging to the GLOBAL_WORKSPACE_ID bucket are surfaced from
  // the unbound mode; map them back to `null` so the sentinel doesn't leak
  // into state.
  const handleSelectSession = useCallback((session: UnifiedSession) => {
    const targetWorkspaceId =
      session.workspaceId === GLOBAL_WORKSPACE_ID ? null : session.workspaceId;
    if (targetWorkspaceId === workspaceId) {
      setPendingSessionId(session.sessionId);
      return;
    }
    setWorkspaceId(targetWorkspaceId);
    setPendingSessionId(session.sessionId);
  }, [workspaceId]);

  const handleChangeWorkspace = useCallback((next: string | null) => {
    if (next === workspaceId) return;
    setWorkspaceId(next);
    setPendingSessionId(null);
  }, [workspaceId]);

  const handleSessionConsumed = useCallback(() => {
    setPendingSessionId(null);
  }, []);

  const handleToggleRail = useCallback(() => {
    setRailCollapsed((v) => !v);
  }, []);

  const nodes = workspaceId !== null ? getWorkspaceNodes?.(workspaceId) : undefined;
  const rootFolder = workspaceId !== null ? getWorkspaceRootFolder?.(workspaceId) : undefined;

  return (
    <ChatPageBody
      key={workspaceId ?? '__unbound__'}
      workspaceId={workspaceId}
      initialPendingSessionId={pendingSessionId}
      pendingSessionId={pendingSessionId}
      onSessionConsumed={handleSessionConsumed}
      onSelectSession={handleSelectSession}
      onChangeWorkspace={handleChangeWorkspace}
      onWorkspaceContextRequest={onWorkspaceContextRequest}
      allWorkspaces={allWorkspaces}
      nodes={nodes}
      rootFolder={rootFolder}
      onExit={onExit}
      onNodeFocus={onNodeFocus}
      railCollapsed={railCollapsed}
      onToggleRail={handleToggleRail}
    />
  );
};
