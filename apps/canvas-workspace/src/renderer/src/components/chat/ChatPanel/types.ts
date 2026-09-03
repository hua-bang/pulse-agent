import type { MouseEvent, ReactNode } from 'react';
import type {
  AgentContextCanvasRef,
  AgentContextDomReviewComment,
  AgentContextDomSelectionRef,
  AgentContextNodeRef,
  AgentContextTabRef,
  AgentContextTagRef,
  AgentScope,
  CanvasNode,
  WorkspaceOption,
} from '../../../types';
import type { SettingsSection } from '../../settings/Settings';

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
  knowledgeNodes?: Array<{ id: string; title: string; type: CanvasNode['type']; workspaceId?: string }>;
  knowledgeTags?: Array<{ id: string; name: string; workspaceIds?: string[] }>;
  dockTabs?: AgentContextTabRef[];
  selectedNodeIds?: string[];
  contextNodes?: AgentContextNodeRef[];
  contextTags?: AgentContextTagRef[];
  contextCanvases?: AgentContextCanvasRef[];
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
  onTurnComplete?: () => void;
  chatTargetActive?: boolean;
  chatTargetLabel?: string;
  sessionRefreshKey?: string | number;
  onOpenSessionInScope?: (scope: AgentScope, sessionId: string, scopeLabel: string) => void;
}
