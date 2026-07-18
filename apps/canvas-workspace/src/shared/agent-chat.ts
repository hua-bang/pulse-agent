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
  /** Short capped raw HTML preview kept for backwards-compatible context. */
  htmlPreview?: string;
  /** Bounded semantic snapshot of the selected element and its descendants. */
  tree?: AgentContextDomNodeSnapshot;
  /** Actionable descendants such as links, buttons, inputs, and form controls. */
  controls?: AgentContextDomControlSnapshot[];
  accessibility?: AgentContextDomAccessibilitySnapshot;
  snapshot?: AgentContextDomSnapshotMeta;
}

export interface AgentContextDomReviewComment {
  id: string;
  text: string;
  selection: AgentContextDomSelectionRef;
}

export interface AgentContextDomNodeSnapshot {
  tagName: string;
  selector?: string;
  role?: string;
  text?: string;
  attrs?: Record<string, string>;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  children?: AgentContextDomNodeSnapshot[];
  truncated?: boolean;
}

export interface AgentContextDomControlSnapshot {
  selector: string;
  tagName: string;
  label: string;
  role?: string;
  text?: string;
  attrs?: Record<string, string>;
  rect?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface AgentContextDomAccessibilitySnapshot {
  role?: string;
  name?: string;
}

export interface AgentContextDomSnapshotMeta {
  nodeCount: number;
  controlCount: number;
  truncated: boolean;
  maxDepth: number;
  maxChildrenPerNode: number;
  maxTotalNodes: number;
}

/**
 * A right-dock tab the user `@`-mentioned in the composer. Tabs are the
 * browser-like previews in the dock strip (open web pages, node detail,
 * artifacts, canvas previews, workspace terminals). Like other mentions this is a lightweight
 * pointer — the agent reads the tab's live content on demand with
 * `canvas_read_tab` (link/artifact/terminal), `canvas_read_node`
 * (node-detail), or canvas context tools (canvas), rather than the content
 * being dumped into the prompt.
 */
export interface AgentContextTabRef {
  /** Dock tab id (also the webview registry key for link tabs). */
  id: string;
  kind: 'link' | 'node-detail' | 'artifact' | 'canvas' | 'terminal';
  title: string;
  /** For kind === 'link': the current page URL. */
  url?: string;
  /** Owning workspace for node-detail / artifact / terminal reads, and the
   *  registry workspaceId used to read a link tab's live webview. */
  workspaceId?: string;
  /** Workspace whose dock session owns this tab. It can differ from the
   *  content workspace for canvas, artifact, and node-detail previews. */
  dockWorkspaceId?: string;
  /** For kind === 'node-detail': the referenced canvas node id. */
  nodeId?: string;
  /** For kind === 'artifact': the referenced artifact id. */
  artifactId?: string;
  /** For kind === 'terminal': the PTY session id to read scrollback from. */
  sessionId?: string;
  /** Whether this tab owns focus, even if the dock is currently collapsed. */
  isActive?: boolean;
  /** Whether this tab is currently rendered as a visible dock pane. */
  isVisible?: boolean;
  /** Whether this tab is paired beside chat in split view. */
  isSplit?: boolean;
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
  /** Right-dock tabs the user `@`-mentioned in the composer. */
  tabs?: AgentContextTabRef[];
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
