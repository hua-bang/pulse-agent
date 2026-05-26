import type { MouseEvent } from 'react';
import type { AgentChatToolCall, AgentSessionInfo, CanvasNode, ChatImageAttachment } from '../../types';
import type { SettingsSection } from '../Settings';
import type { I18nKey } from '../../i18n';

export interface WorkspaceOption {
  id: string;
  name: string;
}

export interface ChatPanelProps {
  workspaceId: string;
  allWorkspaces?: WorkspaceOption[];
  nodes?: CanvasNode[];
  selectedNodeIds?: string[];
  rootFolder?: string;
  onClose: () => void;
  onResizeStart?: (e: MouseEvent) => void;
  onNodeFocus?: (nodeId: string) => void;
  /** Opens the global Settings drawer focused on the given section. */
  onOpenAppSettings: (section: SettingsSection) => void;
  /** Called once the insert-mention function is ready; returns a cleanup fn. */
  onRegisterInsertMention?: (fn: (node: CanvasNode) => void) => () => void;
}

export interface OtherWorkspaceSession extends AgentSessionInfo {
  sourceWorkspaceId: string;
  workspaceName: string;
}

export type ToolCallStatus = AgentChatToolCall;

export type { ChatImageAttachment };

export interface MentionItem {
  type: 'node' | 'file' | 'folder' | 'workspace' | 'skill';
  label: string;
  nodeType?: CanvasNode['type'];
  path?: string;
  workspaceId?: string;
  /** For type === 'skill': the skill's description, shown in the popup row. */
  description?: string;
}

export interface PendingClarification {
  id: string;
  question: string;
  context?: string;
}

export interface QuickAction {
  key: 'summarize_canvas' | 'analyze_relations' | 'create_mindmap' | 'organize_selection';
  label: string;
  labelKey?: I18nKey;
  prompt: string;
  promptKey?: I18nKey;
  requiresSelection?: boolean;
}
