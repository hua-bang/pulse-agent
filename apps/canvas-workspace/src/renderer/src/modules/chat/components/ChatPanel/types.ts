import type { MouseEvent, ReactNode } from 'react';
import type {
  AgentContextCanvasRef,
  AgentContextDomReviewComment,
  AgentContextDomSelectionRef,
  AgentContextNodeRef,
  AgentContextScheduledTaskRef,
  AgentContextTabRef,
  AgentContextTagRef,
  AgentScope,
  CanvasNode,
  WorkspaceOption,
} from '../../../../types';
import type { SettingsSection } from '../../../settings';
import type { ChatPromptSubmission } from '../../target';

/** One-shot request from another product surface to focus or submit the composer. */
export interface ChatComposerRequest {
  id: string;
  text?: string;
  submit?: boolean;
  quickAction?: string;
}

export interface ChatPanelProps {
  workspaceId?: string;
  agentScope?: AgentScope;
  knowledgeMode?: boolean;
  banner?: ReactNode;
  pendingLabel?: string;
  allWorkspaces?: WorkspaceOption[];
  nodes?: CanvasNode[];
  knowledgeTags?: Array<{ id: string; name: string; workspaceIds?: string[] }>;
  dockTabs?: AgentContextTabRef[];
  contextNodes?: AgentContextNodeRef[];
  contextTags?: AgentContextTagRef[];
  contextCanvases?: AgentContextCanvasRef[];
  /** Scheduled tasks the user asked about from the Scheduled list. */
  contextScheduledTasks?: AgentContextScheduledTaskRef[];
  composerRequest?: ChatComposerRequest;
  onComposerRequestHandled?: (requestId: string) => void;
  onRemoveContext?: (key: string) => void;
  rootFolder?: string;
  onClose: () => void;
  onResizeStart?: (event: MouseEvent) => void;
  onNodeFocus?: (nodeId: string) => void;
  onOpenAppSettings: (section: SettingsSection) => void;
  onOpenWorkspaceSettings?: (workspaceId: string) => void;
  onRegisterInsertMention?: (fn: (node: CanvasNode, sourceWorkspaceId?: string) => void) => () => void;
  onRegisterStartSkillChat?: (fn: (skillName: string) => Promise<void>) => () => void;
  onRegisterInsertDomSelectionMention?: (fn: (selection: AgentContextDomSelectionRef) => void) => () => void;
  onRegisterInsertTabMention?: (fn: (tab: AgentContextTabRef) => void) => () => void;
  onRegisterSubmitDomReviewComments?: (fn: (comments: AgentContextDomReviewComment[]) => Promise<boolean>) => () => void;
  onRegisterSubmitPrompt?: (fn: (prompt: ChatPromptSubmission) => Promise<boolean>) => () => void;
  onTurnComplete?: () => void;
  chatTargetActive?: boolean;
  chatTargetLabel?: string;
  sessionRefreshKey?: string | number;
  /** Opens this session on mount and on each `sessionRefreshKey` change,
   *  instead of reloading the current one. */
  requestedSessionId?: string;
  onOpenSessionInScope?: (scope: AgentScope, sessionId: string, scopeLabel: string) => void;
}
