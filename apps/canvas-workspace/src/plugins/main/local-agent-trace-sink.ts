import type {
  AgentObservabilitySubscriber,
  AgentTraceEvent,
} from '../../shared/agent-observability';

const MAX_RUNS = 200;
const MAX_EVENTS_PER_RUN = 500;

export class LocalAgentTraceSink implements AgentObservabilitySubscriber {
  readonly id = 'devtools-local-trace';
  private readonly eventsByRun = new Map<string, AgentTraceEvent[]>();

  onEvent(event: AgentTraceEvent): void {
    if (event.type === 'run.started') this.eventsByRun.delete(event.runId);
    const events = this.eventsByRun.get(event.runId) ?? [];
    events.push(event);
    if (events.length > MAX_EVENTS_PER_RUN) events.shift();
    this.eventsByRun.set(event.runId, events);

    while (this.eventsByRun.size > MAX_RUNS) {
      const oldestRunId = this.eventsByRun.keys().next().value;
      if (!oldestRunId) break;
      this.eventsByRun.delete(oldestRunId);
    }
  }

  snapshot(runId: string): AgentTraceEvent[] {
    return [...(this.eventsByRun.get(runId) ?? [])]
      .sort((left, right) => left.timestamp - right.timestamp);
  }
}
