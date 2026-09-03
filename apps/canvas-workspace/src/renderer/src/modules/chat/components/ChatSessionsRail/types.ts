import type { WorkspaceOption } from '../../../../types';
import type { ConversationCompletionStatus } from '../../runtime/conversationCompletionStore';

export interface UnifiedSession {
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  date: string;
  updatedAt?: number;
  messageCount: number;
  preview?: string;
  isCurrent?: boolean;
  isPinned?: boolean;
  running?: boolean;
  completionStatus?: ConversationCompletionStatus;
}

export interface ChatSessionsRailProps {
  allSessions: UnifiedSession[];
  workspaces?: WorkspaceOption[];
  loading?: boolean;
  disabled?: boolean;
  newSessionDisabled?: boolean;
  pendingSessionKey?: string | null;
  onNewSession: () => void | Promise<void>;
  onNewSessionInWorkspace?: (workspaceId: string, trigger: Element | null) => void;
  onSelectSession: (session: UnifiedSession) => void;
  onRenameSession?: (session: UnifiedSession, title: string) => void | Promise<void>;
  onDeleteSession?: (session: UnifiedSession) => void | Promise<void>;
  onTogglePinSession?: (session: UnifiedSession) => void | Promise<void>;
}
