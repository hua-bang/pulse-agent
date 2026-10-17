import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { publish, tracing } = vi.hoisted(() => ({ publish: vi.fn(), tracing: { on: false } }));
vi.mock('../../../plugins/main', () => ({
  publishAgentTraceEvent: publish,
  hasAgentTraceSubscribers: () => tracing.on,
}));

import { canvasAgentObservabilityEnginePlugin } from './engine-plugin';

const setup = async () => {
  const hooks = new Map<string, (input: any) => unknown>();
  const events = new EventEmitter();
  await canvasAgentObservabilityEnginePlugin.initialize({
    registerHook: (name: string, handler: (input: any) => unknown) => hooks.set(name, handler),
    events,
  });
  return Object.assign(hooks, { events });
};

describe('canvas Engine observability plugin', () => {
  beforeEach(() => {
    publish.mockReset();
    tracing.on = false;
  });

  it('records Engine generations and tools against the shared run id', async () => {
    const hooks = await setup();
    const context = {};
    hooks.get('beforeRun')!({ context, runContext: { runId: 'run-1', runtimeId: 'engine' } });
    hooks.get('beforeLLMCall')!({ context, model: 'gpt-test' });
    hooks.get('afterLLMCall')!({ context, finishReason: 'tool-calls' });
    hooks.get('beforeToolCall')!({
      context, name: 'canvas_read_node', toolContext: { toolCallId: 'tool-1' },
    });
    hooks.get('afterToolCall')!({ context, name: 'canvas_read_node' });

    expect(publish.mock.calls.map(([item]) => item.type)).toEqual([
      'generation.started',
      'generation.completed',
      'tool.started',
      'tool.completed',
    ]);
    expect(publish.mock.calls.every(([item]) => item.runId === 'run-1')).toBe(true);
  });

  it('links Codemode script calls to the outer tool call', async () => {
    const hooks = await setup();
    const context = {};
    hooks.get('beforeRun')!({ context, runContext: { runId: 'run-1', runtimeId: 'engine' } });
    const nested = { toolCallId: 'call_1:1', parentToolCallId: 'call_1', resultTarget: 'script' };
    hooks.get('beforeToolCall')!({ context, name: 'codemode', toolContext: { toolCallId: 'call_1' } });
    hooks.get('beforeToolCall')!({ context, name: 'canvas_read_node', toolContext: nested });
    hooks.get('afterToolCall')!({ context, name: 'canvas_read_node', toolContext: nested });
    hooks.get('afterToolCall')!({ context, name: 'codemode', toolContext: { toolCallId: 'call_1' } });

    expect(publish.mock.calls.map(([item]) => [item.type, item.toolCallId, item.parentToolCallId])).toEqual([
      ['tool.started', 'call_1', undefined],
      ['tool.started', 'call_1:1', 'call_1'],
      ['tool.completed', 'call_1:1', 'call_1'],
      ['tool.completed', 'call_1', undefined],
    ]);
  });

  it('does not misreport Pi policy refreshes as model generations', async () => {
    const hooks = await setup();
    const context = {};
    hooks.get('beforeRun')!({
      context, runContext: { runId: 'run-pi', runtimeId: 'pi-agent-harness' },
    });
    hooks.get('beforeLLMCall')!({ context, model: 'pi-model' });
    hooks.get('afterLLMCall')!({ context, finishReason: 'stop' });

    expect(publish).not.toHaveBeenCalled();
  });

  it('carries provider timings and token usage on completed Engine generations', async () => {
    const hooks = await setup();
    const context = {};
    hooks.get('beforeRun')!({ context, runContext: { runId: 'run-2', runtimeId: 'engine' } });
    hooks.get('beforeLLMCall')!({ context, model: 'gpt-test' });
    hooks.get('afterLLMCall')!({
      context,
      finishReason: 'stop',
      timings: { requestStartAt: 10, firstChunkAt: 40, firstTextAt: 55, lastChunkAt: 90 },
      usage: {
        inputTokens: 900,
        inputTokenDetails: { cacheReadTokens: 800 },
        outputTokens: 60,
        outputTokenDetails: { reasoningTokens: 20 },
      },
    });

    expect(publish.mock.calls[1][0]).toMatchObject({
      type: 'generation.completed',
      timings: { requestStartedAt: 10, firstChunkAt: 40, firstTextAt: 55, lastChunkAt: 90 },
      usage: { inputTokens: 900, cachedInputTokens: 800, outputTokens: 60, reasoningTokens: 20 },
    });
  });

  it('omits timings and usage the runtime did not report', async () => {
    const hooks = await setup();
    const context = {};
    hooks.get('beforeRun')!({ context, runContext: { runId: 'run-3', runtimeId: 'engine' } });
    hooks.get('beforeLLMCall')!({ context });
    hooks.get('afterLLMCall')!({ context, finishReason: 'stop', timings: { requestStartAt: undefined } });

    expect(publish.mock.calls[1][0].timings).toBeUndefined();
    expect(publish.mock.calls[1][0].usage).toBeUndefined();
  });

  it('fingerprints the prompt prefix only while someone is listening', async () => {
    const hooks = await setup();
    const context = {};
    hooks.get('beforeRun')!({ context, runContext: { runId: 'run-4', runtimeId: 'engine' } });
    hooks.get('beforeLLMCall')!({ context, systemPrompt: 'system', tools: { a: { description: 'A' } } });
    expect(publish.mock.calls[0][0].prompt).toBeUndefined();

    tracing.on = true;
    hooks.get('beforeLLMCall')!({ context, systemPrompt: 'system', tools: { a: { description: 'A' } } });
    expect(publish.mock.calls[1][0].prompt).toMatchObject({ toolCount: 1, systemChars: 6 });
  });

  it('pairs parallel calls of one tool by id, whatever order they finish in', async () => {
    const hooks = await setup();
    const context = {};
    hooks.get('beforeRun')!({ context, runContext: { runId: 'run-5', runtimeId: 'engine' } });
    hooks.get('beforeToolCall')!({ context, name: 'read', toolContext: { toolCallId: 'a' } });
    hooks.get('beforeToolCall')!({ context, name: 'read', toolContext: { toolCallId: 'b' } });
    hooks.get('afterToolCall')!({ context, name: 'read', toolContext: { toolCallId: 'b' } });
    hooks.get('onToolError')!({ context, name: 'read', toolContext: { toolCallId: 'a' }, error: new Error('x') });

    expect(publish.mock.calls.slice(2).map(([item]) => [item.toolCallId, item.status])).toEqual([
      ['b', 'done'],
      ['a', 'error'],
    ]);
  });

  it('records retry waits, header timing and request ids on failed generations', async () => {
    const hooks = await setup();
    const context = {};
    hooks.get('beforeRun')!({ context, runContext: { runId: 'run-6', runtimeId: 'engine' } });
    hooks.get('beforeLLMCall')!({ context });
    hooks.get('afterLLMCall')!({
      context, finishReason: 'error', error: new Error('overloaded'), requestId: 'req_1',
      retry: { attempt: 1, delayMs: 2000 },
      timings: { requestStartAt: 10, responseHeadersAt: 25, httpAttempts: 2 },
    });

    expect(publish.mock.calls[1][0]).toMatchObject({
      type: 'generation.completed', error: 'overloaded', requestId: 'req_1', httpAttempts: 2,
      retry: { attempt: 1, delayMs: 2000 },
      timings: { requestStartedAt: 10, responseHeadersAt: 25 },
    });
  });

  it('records compaction duration and slow hooks of other plugins only', async () => {
    const hooks = await setup();
    const context = {};
    hooks.get('beforeRun')!({ context, runContext: { runId: 'run-7', runtimeId: 'engine' } });
    hooks.get('onCompacted')!({
      context,
      event: { trigger: 'pre-loop', beforeEstimatedTokens: 900, afterEstimatedTokens: 200, startedAt: 5, finishedAt: 50 },
    });
    hooks.events.emit('hookTiming', { hookName: 'beforeRun', pluginName: 'memory', durationMs: 40, at: 100, context });
    hooks.events.emit('hookTiming', { hookName: 'beforeRun', pluginName: 'memory', durationMs: 2, at: 150, context });
    hooks.events.emit('hookTiming', { hookName: 'beforeRun', pluginName: 'canvas-agent-observability', durationMs: 40, at: 160, context });
    hooks.events.emit('hookTiming', { hookName: 'beforeRun', pluginName: 'memory', durationMs: 40, at: 170, context: {} });

    expect(publish.mock.calls.map(([item]) => item)).toEqual([
      expect.objectContaining({ type: 'context.compacted', trigger: 'pre-loop', startedAt: 5, finishedAt: 50 }),
      expect.objectContaining({ type: 'hook.completed', pluginName: 'memory', startedAt: 100, finishedAt: 140 }),
    ]);
  });
});
