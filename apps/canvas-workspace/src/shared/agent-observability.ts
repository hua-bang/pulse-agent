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
  /** First streamed chunk of any kind (reasoning, tool input, or text). */
  firstChunkAt?: number;
  firstTextAt?: number;
  lastChunkAt?: number;
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
    })
  | (AgentTraceEventBase & {
      type: 'tool.started';
      toolCallId: string;
      toolName: string;
      owner: 'engine' | 'pi';
    })
  | (AgentTraceEventBase & {
      type: 'tool.completed';
      toolCallId: string;
      toolName: string;
      owner: 'engine' | 'pi';
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

export interface AgentObservabilityPublisher {
  publish(event: AgentTraceEvent): void;
}

export interface AgentObservabilityMarkInput {
  runId: string;
  milestone: Extract<
    AgentTraceMilestone,
    'ui.request-dispatched' | 'ui.first-content-rendered' | 'ui.response-completed'
  >;
  timestamp: number;
}
