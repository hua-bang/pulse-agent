import type { ReactNode } from 'react';
import type { CanvasNode, AgentNewSessionResult, AgentScope, WorkspaceOption } from '../../../../types';
import type { SettingsSection } from '../../../../components/settings/Settings';
import type { ChatContextSnapshot, ChatExecutionPolicy } from '../../target';
import type { UnifiedSession } from '../ChatSessionsRail';
import type { SessionBackEntry } from '../SessionBackBar';

export interface ChatPageBodyProps {
  agentScope: AgentScope;
  contextSnapshot?: ChatContextSnapshot;
  executionPolicy?: ChatExecutionPolicy;
  initialPendingSessionId: string | null;
  pendingSessionId: string | null;
  pendingSessionIntentId: number | null;
  selectedSessionKey?: string | null;
  pendingSessionKey?: string | null;
  onSessionConsumed: (intentId: number, loaded: boolean) => void;
  onCreateNewSessionInScope?: (scope: AgentScope) => Promise<AgentNewSessionResult>;
  onNewSessionCreated?: (scope: AgentScope) => void;
  onActiveSessionResolved?: (sessionId: string, workspaceId: string) => void;
  onSelectSession: (session: UnifiedSession) => void;
  onJumpToSession?: (session: { sessionId: string; workspaceId: string }) => void;
  backEntry?: SessionBackEntry | null;
  onPushBackEntry?: (entry: SessionBackEntry) => void;
  onBackToSession?: () => void;
  onClearBackStack?: () => void;
  onWorkspaceContextRequest?: (workspaceId: string) => void;
  allWorkspaces: WorkspaceOption[];
  nodes?: CanvasNode[];
  rootFolder?: string;
  onExit: () => void;
  onNodeFocus?: (workspaceId: string, nodeId: string) => void;
  railCollapsed: boolean;
  onToggleRail: () => void;
  onOpenAppSettings: (section: SettingsSection) => void;
  fixedChat?: { title: string; banner?: ReactNode };
}
