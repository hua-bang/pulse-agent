/**
 * Canvas Agent type definitions.
 *
 * The Canvas Agent is a workspace-scoped AI Copilot that runs in the
 * Electron main process. It understands the entire canvas context and
 * can perform canvas operations, file I/O, and coding tasks directly.
 */

// ─── Configuration ──────────────────────────────────────────────────

export interface CanvasAgentConfig {
  workspaceId: string;
  workspaceDir: string;
  /** Optional model override (e.g. 'gpt-4o', 'claude-sonnet-4-20250514'). */
  model?: string;
}

// ─── Messages ───────────────────────────────────────────────────────

export interface CanvasAgentImageAttachment {
  id: string;
  path: string;
  fileName?: string;
  mimeType?: string;
}

export interface CanvasAgentToolCall {
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

export interface CanvasAgentDebugTraceNodeRef {
  id: string;
  title: string;
  type: string;
  workspaceId?: string;
  workspaceName?: string;
  contentChars?: number;
  source?: 'selected' | 'read_node' | 'read_context';
}

export interface CanvasAgentDebugTraceContextRead {
  workspaceId?: string;
  workspaceName?: string;
  detail?: string;
  nodeCount?: number;
  resultChars?: number;
}

export interface CanvasAgentDebugTraceToolCall {
  name: string;
  toolCallId?: string;
  status: 'running' | 'done' | 'error';
  argsPreview?: string;
  resultSummary?: string;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  readNodes?: CanvasAgentDebugTraceNodeRef[];
  contextRead?: CanvasAgentDebugTraceContextRead;
}

export interface CanvasAgentDebugTraceMessageSnapshot {
  systemPrompt: string;
  systemPromptChars: number;
  messagesJson: string;
  messagesChars: number;
  messageCount: number;
  limitChars: number;
  truncated?: boolean;
}

export interface CanvasAgentDebugTrace {
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
    selectedNodes: CanvasAgentDebugTraceNodeRef[];
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
  messageSnapshot?: CanvasAgentDebugTraceMessageSnapshot;
  model?: {
    provider?: string;
    model?: string;
    modelType?: string;
  };
  toolCalls: CanvasAgentDebugTraceToolCall[];
  readNodes: CanvasAgentDebugTraceNodeRef[];
  contextReads: CanvasAgentDebugTraceContextRead[];
  truncated?: boolean;
}

export interface CanvasAgentMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  attachments?: CanvasAgentImageAttachment[];
  toolCalls?: CanvasAgentToolCall[];
  debugTrace?: CanvasAgentDebugTrace;
}

// ─── Session persistence ────────────────────────────────────────────

export interface CanvasAgentSession {
  sessionId: string;
  workspaceId: string;
  startedAt: string;
  messages: CanvasAgentMessage[];
}

export interface CanvasAgentDebugRunSummary {
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

export interface CanvasAgentDebugRunDetail extends CanvasAgentDebugRunSummary {
  userMessage?: CanvasAgentMessage;
  assistantMessage: CanvasAgentMessage;
  trace: CanvasAgentDebugTrace;
}

// ─── Workspace context (lightweight summary) ────────────────────────

export interface NodeSummary {
  id: string;
  type: string;
  title: string;
  /** File path for file nodes, cwd for terminal/agent nodes. */
  path?: string;
  /** Agent type for agent nodes. */
  agentType?: string;
  /** Running status for agent nodes. */
  status?: string;
  /** Container color for frame/group nodes. */
  color?: string;
  /** Container label for frame/group nodes. */
  label?: string;
  /** Explicit member node ids for group nodes. */
  childIds?: string[];
  /** Embedded URL for iframe nodes. */
  url?: string;
  /** Local image path for image nodes. */
  imagePath?: string;
  /** Root topic text for mindmap nodes. */
  rootText?: string;
  /** Total topic count (including root) for mindmap nodes. */
  topicCount?: number;
}

/**
 * Compact description of a single edge for prompt / JSON responses.
 * Endpoints are pre-resolved to human-readable labels so the agent
 * doesn't need to cross-reference node IDs from the separate node list.
 */
export interface EdgeSummary {
  id: string;
  source: string;
  target: string;
  /** Raw node IDs when the endpoint is node-bound; useful for follow-up tool calls. */
  sourceNodeId?: string;
  targetNodeId?: string;
  label?: string;
  kind?: string;
}

export interface WorkspaceSummary {
  workspaceId: string;
  workspaceName: string;
  canvasDir: string;
  nodeCount: number;
  nodes: NodeSummary[];
  /** Edges are optional for backwards compatibility with callers that
   *  pre-date the connections feature. */
  edges?: EdgeSummary[];
}

// ─── Events (main → renderer) ──────────────────────────────────────

export type CanvasAgentEventType =
  | 'chunk'          // streaming text delta
  | 'tool-call'      // agent is calling a tool
  | 'tool-result'    // tool call completed
  | 'done'           // turn complete
  | 'error';         // error occurred

export interface CanvasAgentEvent {
  type: CanvasAgentEventType;
  data: Record<string, unknown>;
}

// ─── IPC payloads ──────────────────────────────────────────────────

export interface ChatRequest {
  workspaceId: string;
  message: string;
}

export interface ChatResponse {
  ok: boolean;
  response?: string;
  debugTrace?: CanvasAgentDebugTrace;
  error?: string;
}

export interface AgentStatusResponse {
  ok: boolean;
  active: boolean;
  messageCount: number;
}

export interface SessionListResponse {
  ok: boolean;
  sessions?: Array<{ sessionId: string; date: string; messageCount: number }>;
}

export interface CrossWorkspaceSessionGroup {
  workspaceId: string;
  workspaceName: string;
  sessions: Array<{
    sessionId: string;
    date: string;
    messageCount: number;
    preview: string;
    isCurrent: boolean;
  }>;
}

export interface AllSessionsResponse {
  ok: boolean;
  groups?: CrossWorkspaceSessionGroup[];
  error?: string;
}
