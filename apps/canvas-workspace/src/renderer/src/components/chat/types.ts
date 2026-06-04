import type { MouseEvent } from 'react';
import type { AgentChatToolCall, AgentRequestContext, AgentScope, AgentSessionInfo, CanvasNode, ChatImageAttachment } from '../../types';
import type { SettingsSection } from '../Settings';
import type { I18nKey } from '../../i18n';

export interface WorkspaceOption {
  id: string;
  name: string;
}

export type { AgentScope };

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
  /** For type === 'node': the canvas node id, used to focus it when clicked. */
  nodeId?: string;
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

/**
 * A pre-built first turn handed to the AI Chat page. When present, the page
 * opens on {@link scope}, starts a fresh session, and auto-sends {@link prompt}
 * with {@link requestContext} (e.g. injected tag content) — turning a graph
 * action into an interactive, follow-up-able conversation.
 */
export interface ChatSeed {
  scope: AgentScope;
  /** Visible first user message. */
  prompt: string;
  /** Threaded to the agent alongside the message (carries injectedContext). */
  requestContext?: AgentRequestContext;
}

/** One node's material gathered for a tag-summary seed. */
export interface TagSummaryNode {
  workspaceName: string;
  title: string;
  type: string;
  content: string;
}

/** Emitted by the graph when the user asks AI to summarize a tag vertex. */
export interface TagSummaryRequest {
  tagId: string;
  tagLabel: string;
  nodes: TagSummaryNode[];
}
