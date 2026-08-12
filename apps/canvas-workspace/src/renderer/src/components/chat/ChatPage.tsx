import { useCallback, useRef, useState } from 'react';
import type { CanvasNode } from '../../types';
import type { SettingsSection } from '../settings/Settings';
import type { UnifiedSession } from './ChatSessionsRail';
import { ChatPageBody } from './ChatPageBody';
import type { SessionBackEntry } from './SessionBackBar';
import type { AgentScope, WorkspaceOption } from './types';
import { chatScopeKey, chatSessionKey } from './utils/sessionScope';
import type {
  ActiveChatTarget,
  SetActiveChatTarget,
} from './ChatTargetContext';

const workspaceIdFromScope = (scope: AgentScope): string | null =>
  scope.kind === 'workspace' ? scope.workspaceId : null;

interface ChatPageProps {
  activeChatTarget: ActiveChatTarget;
  setActiveChatTarget: SetActiveChatTarget;
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
 *   - App owns ActiveChatTarget; ChatPage owns only transient navigation intent.
 *   - Inner ChatPageBody: stays mounted across scope changes. Its hooks switch
 *     subscriptions and cached state in place, so selecting another workspace
 *     does not recreate the whole chat surface.
 *
 * Mutual exclusion with ChatPanel is enforced at the App level.
 */
export const ChatPage = ({
  activeChatTarget,
  setActiveChatTarget,
  allWorkspaces,
  getWorkspaceNodes,
  getWorkspaceRootFolder,
  onWorkspaceContextRequest,
  onExit,
  onNodeFocus,
  onOpenAppSettings,
}: ChatPageProps) => {
  const agentScope = activeChatTarget.scope;
  const [pendingSessionIntent, setPendingSessionIntent] = useState<{
    id: number;
    sessionId: string;
  } | null>(
    () => activeChatTarget.sessionId ? { id: 1, sessionId: activeChatTarget.sessionId } : null,
  );
  const sessionIntentSequenceRef = useRef(activeChatTarget.sessionId ? 1 : 0);
  const pendingSessionIntentRef = useRef<number | null>(activeChatTarget.sessionId ? 1 : null);
  const pendingSessionId = pendingSessionIntent?.sessionId ?? null;
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(
    () => activeChatTarget.sessionId
      ? chatSessionKey(activeChatTarget.scope, activeChatTarget.sessionId)
      : null,
  );
  const contextSnapshot = activeChatTarget.contextSnapshot;
  const executionPolicy = activeChatTarget.executionPolicy;
  const scopeRollbackRef = useRef<{
    activeChatTarget: ActiveChatTarget;
    selectedSessionKey: string | null;
    sessionBackStack: SessionBackEntry[];
  } | null>(null);
  const [railCollapsed, setRailCollapsed] = useState(true);
  // Jump trail for session-ref chip navigation. Owned here so scope changes
  // and thread replacement cannot disturb it.
  const [sessionBackStack, setSessionBackStack] = useState<SessionBackEntry[]>([]);
  const scopeKey = chatScopeKey(agentScope);

  // Every session click keeps the body mounted. Cross-scope picks update the
  // scope and pending session together; the body swaps thread data in place.
  const navigateToSession = useCallback((session: { sessionId: string; scope: AgentScope }) => {
    const intentId = ++sessionIntentSequenceRef.current;
    pendingSessionIntentRef.current = intentId;
    setPendingSessionIntent({ id: intentId, sessionId: session.sessionId });
    setSelectedSessionKey(chatSessionKey(session.scope, session.sessionId));
    const nextScope = session.scope;
    const nextScopeKey = chatScopeKey(nextScope);
    scopeRollbackRef.current ??= {
      activeChatTarget, selectedSessionKey, sessionBackStack,
    };
    setActiveChatTarget({
      scope: nextScope,
      sessionId: session.sessionId,
      executionPolicy: nextScope.kind === 'scheduled' ? 'scheduled' : 'auto',
    });
    if (nextScopeKey === scopeKey) {
      return;
    }
  }, [activeChatTarget, scopeKey, selectedSessionKey, sessionBackStack, setActiveChatTarget]);

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
    navigateToSession({ sessionId: entry.sessionId, scope: entry.scope });
  }, [navigateToSession, sessionBackStack]);

  const handleClearBackStack = useCallback(() => {
    setSessionBackStack([]);
  }, []);

  const handleSessionConsumed = useCallback((intentId: number, loaded: boolean) => {
    if (pendingSessionIntentRef.current !== intentId) return;
    pendingSessionIntentRef.current = null;
    setPendingSessionIntent(null);
    const rollback = scopeRollbackRef.current;
    scopeRollbackRef.current = null;
    if (loaded || !rollback) return;
    setActiveChatTarget(rollback.activeChatTarget);
    setSelectedSessionKey(rollback.selectedSessionKey);
    setSessionBackStack(rollback.sessionBackStack);
  }, [setActiveChatTarget]);
  const handleActiveSessionResolved = useCallback((sessionId: string, scope: AgentScope) => {
    setSelectedSessionKey(chatSessionKey(scope, sessionId));
    setActiveChatTarget((current) => current.sessionId === sessionId
      ? current
      : { ...current, sessionId });
  }, [setActiveChatTarget]);

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
