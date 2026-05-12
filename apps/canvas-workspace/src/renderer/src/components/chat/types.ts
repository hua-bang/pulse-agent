import type { MouseEvent } from 'react';
import type { AgentSessionInfo, CanvasNode, ChatImageAttachment } from '../../types';

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

export interface ToolCallStatus {
  id: number;
  name: string;
  args?: any;
  status: 'running' | 'done';
  result?: string;
  /** AI SDK toolCallId — used to correlate streaming-input deltas with the final tool-call. */
  toolCallId?: string;
  /** Accumulated raw JSON of tool arguments while the LLM is still emitting them.
   *  Cleared (or kept as-is) once `inputStreaming` flips to false. */
  partialInput?: string;
  /** True while the LLM is still streaming this tool's input JSON. */
  inputStreaming?: boolean;
  /**
   * Already-extracted partial content that a tool is pushing via side
   * channel (e.g. `visual_render` chunking its final HTML to drive the
   * progressive inline preview). When set, the renderer prefers this over
   * parsing `partialInput`'s JSON — it's the parsed/unescaped string, not
   * a JSON fragment. `streamedContent` may also be populated AFTER the
   * tool returns; the `streamedDone` flag signals the final frame.
   */
  streamedContent?: string;
  streamedDone?: boolean;
}

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
