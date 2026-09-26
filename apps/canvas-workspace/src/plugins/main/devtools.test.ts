import { expect, it } from 'vitest';
import { DevtoolsMainPlugin } from './devtools';
import type { AgentObservabilitySubscriber } from '../../shared/agent-observability';
import type { PluginIpcHandler, PluginStore } from '../types';

it('serializes reads with trace writes and retains terminal/late UI events without a model trace', async () => {
  const records = new Map<string, string>();
  const handlers = new Map<string, PluginIpcHandler>();
  let subscriber!: AgentObservabilitySubscriber;
  let release!: () => void;
  let writing = false;
  let delayWrite = true;
  const store: PluginStore = {
    async get<T>(key: string): Promise<T | undefined> {
      if (writing) throw new Error('Read during a partial JSON write');
      const value = records.get(key);
      return value ? JSON.parse(value) : undefined;
    },
    async set(key, value) {
      writing = true;
      if (delayWrite) await new Promise<void>(resolve => { release = resolve; });
      records.set(key, JSON.stringify(value));
      writing = false;
    },
    async delete(key) { records.delete(key); },
    async list() { return [...records.keys()]; },
  };
  await DevtoolsMainPlugin.activate({
    store,
    handle: (name: string, handler: PluginIpcHandler) => handlers.set(name, handler),
    onAgent: () => () => undefined,
    registerAgentObservabilitySubscriber: (value: AgentObservabilitySubscriber) => {
      subscriber = value;
      return () => undefined;
    },
  } as never);
  await subscriber.onEvent({ type: 'run.started', runId: 'one', timestamp: 100, scope: 'global', host: 'canvas' });
  await subscriber.onEvent({ type: 'milestone', runId: 'one', timestamp: 90, milestone: 'ui.request-dispatched', owner: 'renderer' });
  const completed = subscriber.onEvent({ type: 'run.completed', runId: 'one', timestamp: 200, status: 'error' });
  // Let the deferred store write begin, then issue a concurrent renderer read.
  for (let i = 0; i < 10 && !release; i++) await Promise.resolve();
  expect(release).toBeTypeOf('function');
  const read = handlers.get('get-run')!({ sender: null, frameId: 0 }, 'one');
  delayWrite = false;
  release();
  await completed;
  expect(await read).toMatchObject({ runId: 'one', durationMs: 110, trace: { durationMs: 110, observabilityEvents: [
    expect.objectContaining({ milestone: 'ui.request-dispatched' }),
    expect.objectContaining({ type: 'run.started' }), expect.objectContaining({ status: 'error' }),
  ] } });
  await subscriber.onEvent({ type: 'milestone', runId: 'one', timestamp: 220, milestone: 'ui.response-completed', owner: 'renderer' });
  const persisted = await store.get<{ detail: { trace: { observabilityEvents: unknown[] } } }>('runs/one');
  expect(persisted?.detail.trace.observabilityEvents).toHaveLength(4);
});
