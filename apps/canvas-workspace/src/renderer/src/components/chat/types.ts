import type { MouseEvent } from 'react';
import type { AgentChatToolCall, AgentContextCanvasRef, AgentContextDomSelectionRef, AgentContextNodeRef, AgentContextTagRef, AgentScope, AgentSessionInfo, CanvasNode, ChatImageAttachment } from '../../types';
import type { SettingsSection } from '../Settings';
import type { I18nKey } from '../../i18n';

export interface WorkspaceOption {
  id: string;
  name: string;
}

export type { AgentScope };

/**
 * Pre-resolved descriptor for a "current context" chip in the composer.
 * Decouples the chip strip from `CanvasNode` so a cross-workspace host (the
 * Nodes / Graph knowledge assistant) can supply already-resolved labels —
 * for nodes, whole canvases, or tags — without owning full canvas node objects.
 */
export interface SelectedContextChip {
  key: string;
  kind: 'node' | 'tag' | 'canvas';
  /** For kind === 'node': the canvas node type, drives the chip icon. */
  nodeType?: CanvasNode['type'];
  label: string;
}

export interface ChatPanelProps {
  /**
   * Workspace the panel is bound to. Optional because a global-scope host
   * (Nodes / Graph) renders the same panel without a current canvas — pass
   * `agentScope: { kind: 'global' }` instead.
   */
  workspaceId?: string;
  /**
   * Chat scope. Defaults to `{ kind: 'workspace', workspaceId }` so existing
   * canvas callers keep their behavior without passing anything.
   */
  agentScope?: AgentScope;
  allWorkspaces?: WorkspaceOption[];
  nodes?: CanvasNode[];
  /** Cross-workspace knowledge nodes offered in the `@` popup (global host). */
  knowledgeNodes?: Array<{ id: string; title: string; type: CanvasNode['type']; workspaceId?: string }>;
  /** Knowledge tags offered in the `@` popup (global host). */
  knowledgeTags?: Array<{ id: string; name: string; workspaceIds?: string[] }>;
  selectedNodeIds?: string[];
  /**
   * Explicit selection context (with owning `workspaceId`). When provided it
   * drives the request context and the composer chips directly, taking
   * precedence over the `selectedNodeIds` + `nodes` derivation. Used by the
   * cross-workspace global host where selection spans workspaces.
   */
  contextNodes?: AgentContextNodeRef[];
  /** Tags the global host scoped the turn to (rendered as removable chips). */
  contextTags?: AgentContextTagRef[];
  /** Whole canvases the global host scoped the turn to. */
  contextCanvases?: AgentContextCanvasRef[];
  /** Remove a context chip by key. When omitted, chips aren't removable. */
  onRemoveContext?: (key: string) => void;
  rootFolder?: string;
  onClose: () => void;
  onResizeStart?: (e: MouseEvent) => void;
  onNodeFocus?: (nodeId: string) => void;
  /** Opens the global Settings drawer focused on the given section. */
  onOpenAppSettings: (section: SettingsSection) => void;
  /** Called once the insert-mention function is ready; returns a cleanup fn. */
  onRegisterInsertMention?: (fn: (node: CanvasNode) => void) => () => void;
  /** Called once the DOM-selection mention inserter is ready; returns a cleanup fn. */
  onRegisterInsertDomSelectionMention?: (fn: (selection: AgentContextDomSelectionRef) => void) => () => void;
  /** Fires when a streaming turn finishes — hosts use it for unread badges. */
  onTurnComplete?: () => void;
}

export interface OtherWorkspaceSession extends AgentSessionInfo {
  sourceWorkspaceId: string;
  workspaceName: string;
}

export type ToolCallStatus = AgentChatToolCall;

export type { ChatImageAttachment };

export interface MentionItem {
  type: 'node' | 'file' | 'folder' | 'workspace' | 'skill' | 'tag' | 'session' | 'dom';
  label: string;
  nodeType?: CanvasNode['type'];
  /** For type === 'node': the canvas node id, used to focus it when clicked. */
  nodeId?: string;
  path?: string;
  workspaceId?: string;
  /** For type === 'tag': workspaces the tag occurs in (global assistant). */
  workspaceIds?: string[];
  /** For type === 'skill' | 'session': extra context shown in the popup row. */
  description?: string;
  /** For type === 'session': the referenced chat session id. */
  sessionId?: string;
  /** For type === 'session': index of the first message matching the query. */
  messageIndex?: number;
  /** For type === 'dom': selected iframe/webview DOM element context. */
  domSelection?: AgentContextDomSelectionRef;
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
