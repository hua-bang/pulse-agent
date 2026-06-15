import type { CanvasNode } from './canvas';

export interface ChatImageAttachment {
  id: string;
  path: string;
  fileName?: string;
  mimeType?: string;
}

export type AgentScope =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'global' };

export interface AgentScopeRef {
  scope: AgentScope;
}

export interface AgentChatToolCall {
  id: number;
  name: string;
  args?: unknown;
  status: 'running' | 'done';
  result?: string;
  toolCallId?: string;
  partialInput?: string;
  inputStreaming?: boolean;
  streamedContent?: string;
  streamedDone?: boolean;
}

export interface AgentDebugTraceNodeRef {
  id: string;
  title: string;
  type: string;
  workspaceId?: string;
  workspaceName?: string;
  contentChars?: number;
  source?: 'selected' | 'read_node' | 'read_context';
}

export interface AgentDebugTraceContextRead {
  workspaceId?: string;
  workspaceName?: string;
  detail?: string;
  nodeCount?: number;
  resultChars?: number;
}

export interface AgentDebugTraceToolCall {
  name: string;
  toolCallId?: string;
  status: 'running' | 'done' | 'error';
  argsPreview?: string;
  resultSummary?: string;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  readNodes?: AgentDebugTraceNodeRef[];
  contextRead?: AgentDebugTraceContextRead;
}

export interface AgentDebugTraceMessageSnapshot {
  systemPrompt: string;
  systemPromptChars: number;
  messagesJson: string;
  messagesChars: number;
  messageCount: number;
  limitChars: number;
  truncated?: boolean;
}

export interface AgentDebugTrace {
  sessionId: string;
  runId: string;
  turnId: string;
  createdAt: number;
  startedAt: number;
  finishedAt?: number;
  durationMs?: number;
  debugUrl?: string;
  request: {
    userPromptPreview: string;
    attachmentCount: number;
    executionMode?: 'auto' | 'ask';
    scope?: 'current_canvas' | 'selected_nodes';
    quickAction?: string;
    selectedNodes: AgentDebugTraceNodeRef[];
    mentionedCanvases: Array<{ id: string; name: string }>;
    workspace?: {
      id: string;
      name: string;
      nodeCount: number;
    };
  };
  prompt: {
    systemPromptPreview: string;
    systemPromptChars: number;
    currentCanvasSummaryPreview?: string;
    currentCanvasSummaryChars?: number;
  };
  messageSnapshot?: AgentDebugTraceMessageSnapshot;
  model?: {
    provider?: string;
    model?: string;
    modelType?: string;
  };
  toolCalls: AgentDebugTraceToolCall[];
  readNodes: AgentDebugTraceNodeRef[];
  contextReads: AgentDebugTraceContextRead[];
  truncated?: boolean;
}

export interface AgentDebugRunSummary {
  workspaceId: string;
  workspaceName: string;
  sessionId: string;
  runId: string;
  turnId: string;
  messageIndex: number;
  startedAt: number;
  durationMs?: number;
  userPromptPreview: string;
  assistantPreview: string;
  toolCount: number;
  readNodeCount: number;
  modelLabel?: string;
  isCurrent: boolean;
}

export interface AgentDebugRunDetail extends AgentDebugRunSummary {
  userMessage?: AgentChatMessage;
  assistantMessage?: AgentChatMessage;
  trace: AgentDebugTrace;
}

export interface AgentChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  attachments?: ChatImageAttachment[];
  toolCalls?: AgentChatToolCall[];
  /** Stable identifier of the agent turn that produced this message. */
  runId?: string;
}

export interface AgentContextNodeRef {
  id: string;
  title: string;
  type: CanvasNode['type'];
  /**
   * Owning workspace of the node. Required for global-scope chat, where
   * there is no bound canvas and the agent must pass an explicit workspaceId.
   */
  workspaceId?: string;
}

export interface AgentContextTagRef {
  name: string;
  /** Workspaces where this tag occurs. */
  workspaceIds?: string[];
}

export interface AgentContextCanvasRef {
  id: string;
  name: string;
}

export interface AgentContextDomSelectionRef {
  id: string;
  label: string;
  workspaceId?: string;
  nodeId: string;
  nodeTitle?: string;
  url?: string;
  selector: string;
  tagName?: string;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
    scrollX?: number;
    scrollY?: number;
  };
  text?: string;
  html?: string;
}

export interface AgentRequestContext {
  executionMode?: 'auto' | 'ask';
  scope?: 'current_canvas' | 'selected_nodes';
  selectedNodes?: AgentContextNodeRef[];
  /** Tags the user scoped the turn to (global Nodes/Graph assistant). */
  tags?: AgentContextTagRef[];
  /** Whole canvases the user scoped the turn to (global assistant). */
  canvases?: AgentContextCanvasRef[];
  /** DOM elements the user picked inside iframe/webview nodes. */
  domSelections?: AgentContextDomSelectionRef[];
  quickAction?: string;
}

export interface AgentSessionInfo {
  sessionId: string;
  date: string;
  messageCount: number;
  isCurrent: boolean;
  preview?: string;
}

export interface CrossWorkspaceSessionGroup {
  workspaceId: string;
  workspaceName: string;
  sessions: AgentSessionInfo[];
}

/** One hit from the session title search behind the @-mention popup. */
export interface SessionSearchHit {
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  date: string;
  isCurrent: boolean;
  messageCount: number;
  preview: string;
}
