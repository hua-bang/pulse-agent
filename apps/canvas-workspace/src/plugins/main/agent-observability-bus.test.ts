import { describe, expect, it, vi } from 'vitest';

import type { AgentTraceEvent } from '../../shared/agent-observability';
import { AgentObservabilityBus } from './agent-observability-bus';

const event = (runId: string): AgentTraceEvent => ({
  type: 'run.started',
  runId,
  timestamp: 100,
  scope: 'workspace',
  host: 'canvas',
});

describe('AgentObservabilityBus', () => {
  it('delivers events in publish order without blocking publishers', async () => {
    const received: string[] = [];
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>(resolve => { releaseFirst = resolve; });
    const bus = new AgentObservabilityBus();
    bus.subscribe({
      id: 'slow-local-sink',
      async onEvent(item) {
        if (item.runId === 'first') await firstPending;
        received.push(item.runId);
      },
    });

    bus.publish(event('first'));
    bus.publish(event('second'));
    expect(received).toEqual([]);

    releaseFirst();
    await bus.drain();
    expect(received).toEqual(['first', 'second']);
  });

  it('isolates subscriber failures and continues fan-out', async () => {
    const logError = vi.fn();
    const healthy = vi.fn();
    const bus = new AgentObservabilityBus(logError);
    bus.subscribe({ id: 'broken', onEvent: () => { throw new Error('offline'); } });
    bus.subscribe({ id: 'healthy', onEvent: healthy });

    bus.publish(event('run-1'));
    await bus.drain();

    expect(healthy).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledOnce();
  });

  it('unsubscribes by identity and shuts remaining subscribers down', async () => {
    const stopped = vi.fn();
    const bus = new AgentObservabilityBus();
    const unsubscribe = bus.subscribe({ id: 'temporary', onEvent: vi.fn() });
    bus.subscribe({ id: 'persistent', onEvent: vi.fn(), shutdown: stopped });

    unsubscribe();
    await bus.shutdown();

    expect(stopped).toHaveBeenCalledOnce();
  });
});
