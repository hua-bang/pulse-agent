import type { MouseEvent } from 'react';
import type { AgentChatToolCall, AgentSessionInfo, CanvasNode, ChatImageAttachment } from '../../types';

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
}

export interface OtherWorkspaceSession extends AgentSessionInfo {
  sourceWorkspaceId: string;
  workspaceName: string;
}

export type ToolCallStatus = AgentChatToolCall;

export type { ChatImageAttachment };

export interface MentionItem {
  type: 'node' | 'file' | 'workspace';
  label: string;
  nodeType?: CanvasNode['type'];
  path?: string;
  workspaceId?: string;
}

export interface PendingClarification {
  id: string;
  question: string;
  context?: string;
}

export interface QuickAction {
  key: 'summarize_canvas' | 'analyze_relations' | 'create_mindmap' | 'organize_selection';
  label: string;
  prompt: string;
  requiresSelection?: boolean;
}
