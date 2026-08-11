import type { AgentObservabilitySubscriber, AgentTraceEvent } from '../../shared/agent-observability';

export type LangfuseObservationKind = 'agent' | 'event' | 'generation' | 'span' | 'tool';

export interface LangfuseObservationHandle {
  end(timestamp?: Date): void;
  setAttributes(attributes: Record<string, string>): void;
  spanContext(): { traceId: string; spanId: string; traceFlags: number };
  update(attributes: Record<string, unknown>): void;
}

export interface LangfuseTraceAdapter {
  createRoot(runId: string, timestamp: Date, metadata: Record<string, unknown>): Promise<LangfuseObservationHandle>;
  start(
    parent: LangfuseObservationHandle,
    name: string,
    kind: LangfuseObservationKind,
    timestamp: Date,
    attributes?: Record<string, unknown>,
  ): LangfuseObservationHandle;
  shutdown(): Promise<void>;
}

interface RunState {
  root: LangfuseObservationHandle;
  runtime?: LangfuseObservationHandle;
  runtimeId?: string;
  generations: Map<string, LangfuseObservationHandle>;
  tools: Map<string, LangfuseObservationHandle>;
}

const at = (timestamp: number): Date => new Date(timestamp);

export class LangfuseAgentTraceSubscriber implements AgentObservabilitySubscriber {
  readonly id = 'langfuse';
  private readonly runs = new Map<string, RunState>();

  constructor(private readonly adapter: LangfuseTraceAdapter) {}

  async onEvent(event: AgentTraceEvent): Promise<void> {
    if (event.type === 'run.started') {
      await this.startRun(event);
      return;
    }
    const run = this.runs.get(event.runId);
    if (!run) return;

    switch (event.type) {
      case 'runtime.resolved':
        run.runtime?.end(at(event.timestamp));
        run.runtimeId = event.runtimeId;
        run.runtime = this.start(run.root, `runtime.${event.runtimeId}`, 'agent', event.timestamp, {
          metadata: { owner: event.owner, runtimeId: event.runtimeId },
        });
        break;
      case 'phase.completed':
        if (event.phase === 'runtime.execution' && run.runtime) {
          run.runtime.end(at(event.finishedAt));
          run.runtime = undefined;
        } else {
          const phase = this.start(run.root, event.phase, 'span', event.startedAt, {
            metadata: { owner: event.owner, phase: event.phase },
          });
          phase.end(at(event.finishedAt));
        }
        break;
      case 'generation.started': {
        const generation = this.start(run.runtime ?? run.root, `${event.owner}.generation`, 'generation', event.timestamp, {
          model: event.model,
          metadata: { generationId: event.generationId, owner: event.owner },
        });
        run.generations.set(event.generationId, generation);
        break;
      }
      case 'generation.completed': {
        const generation = run.generations.get(event.generationId);
        if (!generation) break;
        generation.update({
          ...(event.finishReason ? { metadata: { finishReason: event.finishReason } } : {}),
          ...(event.error ? { level: 'ERROR', statusMessage: event.error } : {}),
        });
        generation.end(at(event.timestamp));
        run.generations.delete(event.generationId);
        break;
      }
      case 'tool.started': {
        const tool = this.start(run.runtime ?? run.root, event.toolName, 'tool', event.timestamp, {
          metadata: { owner: event.owner, toolCallId: event.toolCallId },
        });
        run.tools.set(event.toolCallId, tool);
        break;
      }
      case 'tool.completed': {
        const tool = run.tools.get(event.toolCallId);
        if (!tool) break;
        if (event.status === 'error') tool.update({ level: 'ERROR', statusMessage: 'Tool failed' });
        tool.end(at(event.timestamp));
        run.tools.delete(event.toolCallId);
        break;
      }
      case 'milestone':
        if (event.milestone === 'runtime.first-text') {
          const activeGeneration = [...run.generations.values()].at(-1);
          activeGeneration?.update({ completionStartTime: at(event.timestamp) });
        }
        this.start(run.runtime ?? run.root, event.milestone, 'event', event.timestamp, {
          metadata: { detail: event.detail, owner: event.owner },
        });
        break;
      case 'context.compacted':
        this.start(run.runtime ?? run.root, 'context.compacted', 'event', event.timestamp, {
          metadata: {
            afterTokens: event.afterTokens,
            beforeTokens: event.beforeTokens,
            owner: event.owner,
          },
        });
        break;
      case 'run.completed':
        this.finishRun(event.runId, event.timestamp, event.status, event.error);
        break;
    }
  }

  async shutdown(): Promise<void> {
    const timestamp = Date.now();
    for (const runId of this.runs.keys()) this.finishRun(runId, timestamp, 'stopped');
    await this.adapter.shutdown();
  }

  private async startRun(event: Extract<AgentTraceEvent, { type: 'run.started' }>): Promise<void> {
    const root = await this.adapter.createRoot(event.runId, at(event.timestamp), {
      canvasRunId: event.runId,
      host: event.host,
      scope: event.scope,
    });
    this.correlate(root, event.runId, event.sessionId);
    this.runs.set(event.runId, {
      root,
      generations: new Map(),
      tools: new Map(),
    });
  }

  private start(
    parent: LangfuseObservationHandle,
    name: string,
    kind: LangfuseObservationKind,
    timestamp: number,
    attributes?: Record<string, unknown>,
  ): LangfuseObservationHandle {
    const observation = this.adapter.start(parent, name, kind, at(timestamp), attributes);
    observation.setAttributes({ 'langfuse.trace.name': 'canvas.agent.turn' });
    return observation;
  }

  private correlate(observation: LangfuseObservationHandle, runId: string, sessionId?: string): void {
    observation.setAttributes({
      'langfuse.trace.metadata': JSON.stringify({ canvasRunId: runId }),
      'langfuse.trace.name': 'canvas.agent.turn',
      ...(sessionId ? { 'session.id': sessionId } : {}),
    });
  }

  private finishRun(runId: string, timestamp: number, status: 'success' | 'error' | 'stopped', error?: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    const finishedAt = at(timestamp);
    for (const observation of [...run.generations.values(), ...run.tools.values()]) {
      observation.update({ level: 'ERROR', statusMessage: 'Run ended before observation completed' });
      observation.end(finishedAt);
    }
    run.runtime?.end(finishedAt);
    run.root.update({
      metadata: { runtimeId: run.runtimeId, status },
      ...(error ? { level: 'ERROR', statusMessage: error } : {}),
    });
    run.root.end(finishedAt);
    this.runs.delete(runId);
  }
}
