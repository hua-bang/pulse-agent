import { beforeEach, describe, expect, it, vi } from 'vitest';

const { publish } = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock('../../../plugins/main', () => ({ publishAgentTraceEvent: publish }));

import { canvasAgentObservabilityEnginePlugin } from './engine-plugin';

const setup = async () => {
  const hooks = new Map<string, (input: any) => unknown>();
  await canvasAgentObservabilityEnginePlugin.initialize({
    registerHook: (name: string, handler: (input: any) => unknown) => hooks.set(name, handler),
  });
  return hooks;
};

describe('canvas Engine observability plugin', () => {
  beforeEach(() => publish.mockReset());

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
});
