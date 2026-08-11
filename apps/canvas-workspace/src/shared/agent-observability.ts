export type AgentTraceOwner = 'renderer' | 'canvas-host' | 'engine' | 'pi';

export type AgentTracePhase =
  | 'renderer.request-dispatch'
  | 'canvas.queue'
  | 'canvas.scope-activation'
  | 'canvas.context-preparation'
  | 'canvas.runtime-dispatch'
  | 'runtime.execution'
  | 'canvas.response-processing';

export type AgentTraceMilestone =
  | 'ui.request-dispatched'
  | 'runtime.first-activity'
  | 'runtime.first-text'
  | 'ui.first-content-rendered';

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
    'ui.request-dispatched' | 'ui.first-content-rendered'
  >;
  timestamp: number;
}
