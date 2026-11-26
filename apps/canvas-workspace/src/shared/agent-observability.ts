export type AgentTraceOwner = 'renderer' | 'canvas-host' | 'engine' | 'pi';

/**
 * Nested steps inside `canvas.scope-activation`. They overlap their parent,
 * so they are not additive turn phases.
 */
export type AgentTraceScopeActivationStep =
  | 'canvas.scope.availability-check'
  | 'canvas.scope.wait-idle'
  | 'canvas.scope.agent-init'
  | 'canvas.scope.agent-init-wait'
  | 'canvas.scope.engine-init'
  | 'canvas.scope.engine-plugin-init'
  | 'canvas.scope.mcp-server'
  | 'canvas.scope.session-restore'
  | 'canvas.scope.session-reconcile';

export type AgentTracePhase =
  | 'renderer.request-dispatch'
  | 'canvas.queue'
  | 'canvas.scope-activation'
  | AgentTraceScopeActivationStep
  | 'canvas.context-preparation'
  | 'canvas.runtime-dispatch'
  | 'runtime.execution'
  | 'canvas.response-processing'
  | 'canvas.persistence';

export interface AgentTraceGenerationTimings {
  /** Request handed to the provider SDK, after hooks and tool wrapping. */
  requestStartedAt?: number;
  /**
   * Response headers arrived. Before it: network, TLS, gateway and queueing.
   * After it, until the first chunk: provider-side work.
   */
  responseHeadersAt?: number;
  /** First streamed chunk of any kind (reasoning, tool input, or text). */
  firstChunkAt?: number;
  firstTextAt?: number;
  lastChunkAt?: number;
}

/**
 * Stability fingerprint of what precedes the conversation in a provider
 * request. Equal hashes across two runs mean the cacheable prefix did not
 * change; hashes only, never prompt or schema content.
 */
export interface AgentTracePromptFingerprint {
  systemHash: string;
  systemChars: number;
  toolsHash: string;
  toolCount: number;
  /** Serialized size of names, descriptions and input schemas. */
  toolsChars: number;
  /** Subset contributed by MCP servers (registered as `mcp_*`). */
  mcpToolCount: number;
  mcpToolsChars: number;
}

export interface AgentTraceGenerationUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
}

export type AgentTraceMilestone =
  | 'ui.request-dispatched'
  | 'runtime.first-activity'
  | 'runtime.first-text'
  | 'ui.first-content-rendered'
  | 'ui.response-completed';

interface AgentTraceEventBase {
  runId: string;
  timestamp: number;
}

export type AgentTraceEvent =
  | (AgentTraceEventBase & {
      type: 'run.started';
      sessionId?: string;
      scope: 'global' | 'workspace' | 'scheduled';
      host: 'canvas';
    })
  | (AgentTraceEventBase & {
      type: 'phase.completed';
      phase: AgentTracePhase;
      owner: AgentTraceOwner;
      startedAt: number;
      finishedAt: number;
      /** Set on nested steps; the parent phase's duration already includes them. */
      parentPhase?: AgentTracePhase;
      /** Which plugin / MCP server a repeated step covers. Metadata only, never content. */
      detail?: string;
    })
  | (AgentTraceEventBase & {
      type: 'runtime.resolved';
      runtimeId: string;
      owner: 'engine' | 'pi';
    })
  | (AgentTraceEventBase & {
      type: 'generation.started';
      generationId: string;
      owner: 'engine' | 'pi';
      model?: string;
      prompt?: AgentTracePromptFingerprint;
    })
  | (AgentTraceEventBase & {
      type: 'generation.completed';
      generationId: string;
      owner: 'engine' | 'pi';
      finishReason?: string;
      error?: string;
      /** Provider-call boundaries when the runtime reports them (Engine does). */
      timings?: AgentTraceGenerationTimings;
      usage?: AgentTraceGenerationUsage;
      /** Provider request id, to match a slow call with provider-side logs. */
      requestId?: string;
      /** HTTP requests for this call; above 1 means the SDK retried by itself. */
      httpAttempts?: number;
      /** The runtime waits `delayMs` after this failed call, then retries. */
      retry?: { attempt: number; delayMs: number };
    })
  | (AgentTraceEventBase & {
      type: 'tool.started';
      toolCallId: string;
      toolName: string;
      owner: 'engine' | 'pi';
      /** Set for calls a Codemode script made inside an outer tool call. */
      parentToolCallId?: string;
    })
  | (AgentTraceEventBase & {
      type: 'tool.completed';
      toolCallId: string;
      toolName: string;
      owner: 'engine' | 'pi';
      parentToolCallId?: string;
      status: 'done' | 'error';
    })
  | (AgentTraceEventBase & {
      type: 'milestone';
      milestone: AgentTraceMilestone;
      owner: AgentTraceOwner;
      detail?: string;
    })
  | (AgentTraceEventBase & {
      type: 'context.compacted';
      owner: 'engine' | 'pi';
      beforeTokens?: number;
      afterTokens?: number;
      trigger?: 'pre-loop' | 'length-retry';
      /** Summarizer call start and compaction end, when the runtime reports them. */
      startedAt?: number;
      finishedAt?: number;
    })
  | (AgentTraceEventBase & {
      /** One slow plugin hook call. Fast calls are not recorded. */
      type: 'hook.completed';
      owner: 'engine' | 'pi';
      hookName: string;
      pluginName: string;
      startedAt: number;
      finishedAt: number;
    })
  | (AgentTraceEventBase & {
      type: 'run.completed';
      status: 'success' | 'error' | 'stopped';
      error?: string;
    });

export interface AgentObservabilitySubscriber {
  id: string;
  onEvent(event: AgentTraceEvent): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export interface AgentObservabilityMarkInput {
  runId: string;
  milestone: Extract<
    AgentTraceMilestone,
    'ui.request-dispatched' | 'ui.first-content-rendered' | 'ui.response-completed'
  >;
  timestamp: number;
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

export interface AgentDebugTracePerformance {
  requestStartedAt: number;
  laneEnteredAt: number;
  scopeReadyAt: number;
  contextReadyAt: number;
  modelStartedAt?: number;
  firstEventAt?: number;
  firstEventType?: 'text' | 'tool-input' | 'tool-call' | 'tool-result';
  firstTextAt?: number;
  runtimeCompletedAt?: number;
  completedAt?: number;
  queueMs?: number;
  scopeActivationMs?: number;
  contextPreparationMs?: number;
  modelStartDelayMs?: number;
  timeToFirstEventMs?: number;
  timeToFirstTextMs?: number;
  runtimeMs?: number;
  responseProcessingMs?: number;
  totalMs?: number;
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
  runtime?: {
    id: string;
  };
  performance?: AgentDebugTracePerformance;
  toolCalls: AgentDebugTraceToolCall[];
  readNodes: AgentDebugTraceNodeRef[];
  contextReads: AgentDebugTraceContextRead[];
  observabilityEvents?: AgentTraceEvent[];
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
  runtimeId?: string;
  isCurrent: boolean;
}

