import { describe, expect, it } from 'vitest';

import type { AgentTraceEvent } from '../../shared/agent-observability';
import { LocalAgentTraceSink } from './local-agent-trace-sink';

describe('LocalAgentTraceSink', () => {
  it('keeps an ordered, run-scoped event snapshot', () => {
    const sink = new LocalAgentTraceSink();
    sink.onEvent({
      type: 'run.completed', runId: 'run-1', timestamp: 30, status: 'success',
    });
    sink.onEvent({
      type: 'milestone', runId: 'run-2', timestamp: 10,
      milestone: 'runtime.first-text', owner: 'engine',
    });
    sink.onEvent({
      type: 'generation.started', runId: 'run-1', timestamp: 20,
      generationId: 'generation-1', owner: 'engine',
    });

    expect(sink.snapshot('run-1').map(event => event.type)).toEqual([
      'generation.started',
      'run.completed',
    ]);
    expect(sink.snapshot('run-2')).toHaveLength(1);
  });

  it('starts a fresh snapshot when a run id is explicitly restarted', () => {
    const sink = new LocalAgentTraceSink();
    sink.onEvent({
      type: 'run.completed', runId: 'run-1', timestamp: 1, status: 'error',
    });
    sink.onEvent({
      type: 'run.started', runId: 'run-1', timestamp: 2,
      scope: 'global', host: 'canvas',
    } satisfies AgentTraceEvent);

    expect(sink.snapshot('run-1').map(event => event.type)).toEqual(['run.started']);
  });

  it('keeps run boundaries when a long run exceeds the event cap', () => {
    const sink = new LocalAgentTraceSink();
    sink.onEvent({ type: 'run.started', runId: 'long', timestamp: 0, scope: 'global', host: 'canvas' });
    for (let index = 1; index <= 600; index++) {
      sink.onEvent({
        type: 'tool.started', runId: 'long', timestamp: index,
        toolCallId: `call-${index}`, toolName: 'read', owner: 'engine',
      });
    }
    sink.onEvent({ type: 'run.completed', runId: 'long', timestamp: 601, status: 'success' });

    const events = sink.snapshot('long');
    expect(events).toHaveLength(500);
    expect(events[0].type).toBe('run.started');
    expect(events.at(-1)?.type).toBe('run.completed');
    // The oldest detail events went first.
    expect(events[1]).toMatchObject({ toolCallId: 'call-103' });
  });
});
