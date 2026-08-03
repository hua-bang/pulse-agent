import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxThinking,
  fauxText,
  fauxToolCall,
} from '@earendil-works/pi-ai';
import type { Engine } from 'pulse-coder-engine';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { createPiAgentHarnessTurnBackend } from './pi-agent-harness-backend';

describe('pi AgentHarness turn backend', () => {
  it('hydrates host history once and streams the real AgentHarness response', async () => {
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    const models = createModels();
    models.setProvider(faux.provider);
    let providerMessages: unknown[] = [];
    let providerSystemPrompt = '';
    faux.setResponses([
      (context) => {
        providerMessages = [...context.messages];
        providerSystemPrompt = context.systemPrompt ?? '';
        return fauxAssistantMessage([
          fauxThinking('private reasoning frame'),
          fauxText('PI_HARNESS_OK'),
        ]);
      },
    ]);
    const backend = createPiAgentHarnessTurnBackend({
      createModelRuntime: () => ({ models, model: faux.getModel() }),
    });
    const recordResponseMessages = vi.fn();
    const onText = vi.fn();
    const dispose = vi.fn();

    const result = await backend.runSegment({
      engine: {
        getTools: () => ({}),
        compactContext: async () => ({ didCompact: false }),
        createToolSession: async () => ({
          getTools: () => ({}),
          getSystemPrompt: () => 'Canvas system prompt + Engine policy',
          executeTool: vi.fn(),
          dispose,
        }),
      } as unknown as Engine,
      context: {
        messages: [
          { role: 'user', content: 'earlier ask' },
          {
            role: 'assistant',
            content: [{
              type: 'tool-call',
              toolCallId: 'old-tool-1',
              toolName: 'canvas_read_context',
              input: { detail: 'summary' },
            }],
          },
          {
            role: 'tool',
            content: [{
              type: 'tool-result',
              toolCallId: 'old-tool-1',
              toolName: 'canvas_read_context',
              output: { type: 'text', value: 'old canvas context' },
            }],
          },
          { role: 'assistant', content: 'earlier answer' },
          { role: 'user', content: 'current ask' },
        ],
      },
      role: null,
      chatSessionId: 'session-1',
      history: [],
      currentAsk: 'current ask',
      handoffNames: [],
      abortSignal: new AbortController().signal,
      executionMode: 'auto',
      onText,
      modelConfig: {
        providerType: 'openai',
        provider: vi.fn(),
        model: 'faux-model',
        modelLabel: 'Faux model',
      },
      systemPrompt: 'Canvas system prompt',
      recordResponseMessages,
      replaceMessages: vi.fn(),
    });

    expect(result.resultText).toBe('PI_HARNESS_OK');
    expect(providerSystemPrompt).toBe('Canvas system prompt + Engine policy');
    expect(providerMessages.filter((message: any) => message.role === 'user')).toHaveLength(2);
    expect(providerMessages.map((message: any) => message.role)).toEqual([
      'user',
      'assistant',
      'toolResult',
      'assistant',
      'user',
    ]);
    expect(providerMessages[1]).toMatchObject({
      role: 'assistant',
      content: [{
        type: 'toolCall',
        id: 'old-tool-1',
        name: 'canvas_read_context',
        arguments: { detail: 'summary' },
      }],
      stopReason: 'toolUse',
    });
    expect(providerMessages[2]).toMatchObject({
      role: 'toolResult',
      toolCallId: 'old-tool-1',
      toolName: 'canvas_read_context',
      content: [{ type: 'text', text: 'old canvas context' }],
    });
    expect(providerMessages.at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'current ask' }],
    });
    expect(onText.mock.calls.flat().join('')).toBe('PI_HARNESS_OK');
    expect(recordResponseMessages).toHaveBeenCalledWith([
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'private reasoning frame' },
          { type: 'text', text: 'PI_HARNESS_OK' },
        ],
      },
    ]);
    expect(dispose).toHaveBeenCalledWith('PI_HARNESS_OK');
  });

  it('loads and executes a deferred Engine tool inside the same AgentHarness run', async () => {
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    const models = createModels();
    models.setProvider(faux.provider);
    const updateNode = vi.fn(async (_input: unknown, _context: unknown) => 'updated');
    let toolsAfterSearch: string[] = [];
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('tool_search_tool_bm25', { query: 'update a node' }, { id: 'search-1' }),
        { stopReason: 'toolUse' },
      ),
      (context) => {
        toolsAfterSearch = context.tools?.map(tool => tool.name) ?? [];
        return fauxAssistantMessage(
          fauxToolCall('canvas_update_node', { id: 'node-1' }, { id: 'update-1' }),
          { stopReason: 'toolUse' },
        );
      },
      fauxAssistantMessage('updated through pi'),
    ]);
    const backend = createPiAgentHarnessTurnBackend({
      createModelRuntime: () => ({ models, model: faux.getModel() }),
    });
    const onToolCall = vi.fn();
    const onToolResult = vi.fn();
    const recordResponseMessages = vi.fn();
    const sourceTools = {
      tool_search_tool_bm25: {
        name: 'tool_search_tool_bm25',
        description: 'Search tools.',
        inputSchema: z.object({ query: z.string() }),
        execute: async () => ({
          type: 'tool_search_tool_search_result',
          tool_references: [{ type: 'tool_reference', tool_name: 'canvas_update_node' }],
        }),
      },
      canvas_update_node: {
        name: 'canvas_update_node',
        description: 'Update a node.',
        inputSchema: z.object({ id: z.string() }),
        defer_loading: true,
        execute: updateNode,
      },
    };
    const visible = new Set(['tool_search_tool_bm25']);
    const dispose = vi.fn();
    const executeTool = vi.fn(async (name: keyof typeof sourceTools, input: unknown, context: unknown) => {
      if (!visible.has(name)) throw new Error(`Unavailable tool: ${name}`);
      if (name === 'tool_search_tool_bm25') {
        const output = await sourceTools.tool_search_tool_bm25.execute();
        visible.add('canvas_update_node');
        return output;
      }
      return sourceTools.canvas_update_node.execute(input as never, context as never);
    });

    const result = await backend.runSegment({
      engine: {
        // Simulate a beforeRun policy adding a tool that is absent from the
        // Engine's static registry. Pi must use the policy session definition.
        getTools: () => ({ tool_search_tool_bm25: sourceTools.tool_search_tool_bm25 }),
        compactContext: async () => ({ didCompact: false }),
        createToolSession: async () => ({
          getRegisteredTools: () => sourceTools,
          getTools: () => Object.fromEntries(
            Object.entries(sourceTools).filter(([name]) => visible.has(name)),
          ),
          getSystemPrompt: () => 'Canvas system prompt',
          executeTool,
          dispose,
        }),
      } as unknown as Engine,
      context: { messages: [{ role: 'user', content: 'update node-1' }] },
      role: null,
      chatSessionId: 'session-tools',
      history: [],
      currentAsk: 'update node-1',
      handoffNames: [],
      abortSignal: new AbortController().signal,
      executionMode: 'auto',
      onText: vi.fn(),
      onToolCall,
      onToolResult,
      modelConfig: {
        providerType: 'openai',
        provider: vi.fn(),
        model: 'faux-model',
        modelLabel: 'Faux model',
      },
      systemPrompt: 'Canvas system prompt',
      recordResponseMessages,
      replaceMessages: vi.fn(),
    });

    expect(toolsAfterSearch).toContain('canvas_update_node');
    expect(updateNode).toHaveBeenCalledWith(
      { id: 'node-1' },
      expect.objectContaining({ toolCallId: 'update-1' }),
    );
    expect(result.resultText).toBe('updated through pi');
    expect(result.toolCalls).toEqual([
      expect.objectContaining({ name: 'tool_search_tool_bm25', status: 'succeeded' }),
      expect.objectContaining({ name: 'canvas_update_node', status: 'succeeded' }),
    ]);
    expect(onToolCall).toHaveBeenCalledTimes(2);
    expect(onToolResult).toHaveBeenCalledTimes(2);
    const recordedMessages = recordResponseMessages.mock.calls
      .flatMap(([messages]) => messages) as any[];
    expect(recordedMessages.map(message => message.role)).toEqual([
      'assistant',
      'tool',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(recordedMessages[1].content[0].output).toMatchObject({
      type: 'json',
      value: { type: 'tool_search_tool_search_result' },
    });
    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledWith('updated through pi');
  });

  it('uses host compaction and writes the compacted history back before prompting pi', async () => {
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    const models = createModels();
    models.setProvider(faux.provider);
    let providerMessages: unknown[] = [];
    faux.setResponses([(context) => {
      providerMessages = [...context.messages];
      return fauxAssistantMessage('compacted answer');
    }]);
    const compactedMessages = [
      { role: 'user' as const, content: 'compacted summary' },
      { role: 'user' as const, content: 'current ask' },
    ];
    const replaceMessages = vi.fn();
    const backend = createPiAgentHarnessTurnBackend({
      createModelRuntime: () => ({ models, model: faux.getModel() }),
    });

    await backend.runSegment({
      engine: {
        getTools: () => ({}),
        compactContext: async () => ({ didCompact: true, newMessages: compactedMessages }),
        createToolSession: async () => ({
          getTools: () => ({}),
          getSystemPrompt: () => 'Canvas system prompt',
          executeTool: vi.fn(),
          dispose: vi.fn(),
        }),
      } as unknown as Engine,
      context: {
        messages: [
          { role: 'user', content: 'very old context' },
          { role: 'user', content: 'current ask' },
        ],
      },
      role: null,
      chatSessionId: 'session-compaction',
      history: [],
      currentAsk: 'current ask',
      handoffNames: [],
      abortSignal: new AbortController().signal,
      executionMode: 'auto',
      onText: vi.fn(),
      modelConfig: {
        providerType: 'openai',
        provider: vi.fn(),
        model: 'faux-model',
        modelLabel: 'Faux model',
      },
      systemPrompt: 'Canvas system prompt',
      recordResponseMessages: vi.fn(),
      replaceMessages,
    });

    expect(replaceMessages).toHaveBeenCalledWith(compactedMessages);
    expect(providerMessages.map((message: any) => message.content)).toEqual([
      'compacted summary',
      [{ type: 'text', text: 'current ask' }],
    ]);
  });

  it('forwards steering into the active AgentHarness run', async () => {
    const faux = fauxProvider({ tokensPerSecond: 100 });
    const models = createModels();
    models.setProvider(faux.provider);
    const providerTurns: unknown[][] = [];
    faux.setResponses([
      (context) => {
        providerTurns.push([...context.messages]);
        return fauxAssistantMessage('initial answer');
      },
      (context) => {
        providerTurns.push([...context.messages]);
        return fauxAssistantMessage('revised answer');
      },
    ]);
    const backend = createPiAgentHarnessTurnBackend({
      createModelRuntime: () => ({ models, model: faux.getModel() }),
    });
    let steerResult: Promise<boolean> | undefined;

    const run = backend.runSegment({
      engine: {
        getTools: () => ({}),
        compactContext: async () => ({ didCompact: false }),
        createToolSession: async () => ({
          getTools: () => ({}),
          getSystemPrompt: () => 'Canvas system prompt',
          executeTool: vi.fn(),
          dispose: vi.fn(),
        }),
      } as unknown as Engine,
      context: { messages: [{ role: 'user', content: 'initial ask' }] },
      role: null,
      chatSessionId: 'session-steer',
      history: [],
      currentAsk: 'initial ask',
      handoffNames: [],
      abortSignal: new AbortController().signal,
      executionMode: 'auto',
      onText: () => {
        steerResult ??= backend.steer!('session-steer', 'please revise');
      },
      modelConfig: {
        providerType: 'openai',
        provider: vi.fn(),
        model: 'faux-model',
        modelLabel: 'Faux model',
      },
      systemPrompt: 'Canvas system prompt',
      recordResponseMessages: vi.fn(),
      replaceMessages: vi.fn(),
    });

    const result = await run;
    expect(await steerResult).toBe(true);
    expect(providerTurns).toHaveLength(2);
    expect(providerTurns[1].at(-1)).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'please revise' }],
    });
    expect(result.resultText).toBe('revised answer');
    expect(await backend.followUp!('missing-session', 'later')).toBe(false);
  });

  it('surfaces provider failures instead of persisting an empty success', async () => {
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage('', {
        stopReason: 'error',
        errorMessage: 'upstream rejected the request',
      }),
    ]);
    const dispose = vi.fn();
    const recordResponseMessages = vi.fn();
    const backend = createPiAgentHarnessTurnBackend({
      createModelRuntime: () => ({ models, model: faux.getModel() }),
    });

    await expect(backend.runSegment({
      engine: {
        getTools: () => ({}),
        compactContext: async () => ({ didCompact: false }),
        createToolSession: async () => ({
          getTools: () => ({}),
          getSystemPrompt: () => 'Canvas system prompt',
          executeTool: vi.fn(),
          dispose,
        }),
      } as unknown as Engine,
      context: { messages: [{ role: 'user', content: 'fail' }] },
      role: null,
      chatSessionId: 'session-error',
      history: [],
      currentAsk: 'fail',
      handoffNames: [],
      abortSignal: new AbortController().signal,
      executionMode: 'auto',
      onText: vi.fn(),
      modelConfig: {
        providerType: 'openai',
        provider: vi.fn(),
        model: 'faux-model',
        modelLabel: 'Faux model',
      },
      systemPrompt: 'Canvas system prompt',
      recordResponseMessages,
      replaceMessages: vi.fn(),
    })).rejects.toThrow('upstream rejected the request');

    expect(recordResponseMessages).not.toHaveBeenCalled();
    expect(dispose).toHaveBeenCalledWith('');
  });

  it('closes the Engine tool session when pi tool setup fails', async () => {
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    const models = createModels();
    models.setProvider(faux.provider);
    const dispose = vi.fn();
    const backend = createPiAgentHarnessTurnBackend({
      createModelRuntime: () => ({ models, model: faux.getModel() }),
    });

    await expect(backend.runSegment({
      engine: {
        getTools: () => ({
          malformed: {
            name: 'malformed',
            description: 'Malformed test tool.',
            inputSchema: undefined,
            execute: vi.fn(),
          },
        }),
        compactContext: async () => ({ didCompact: false }),
        createToolSession: async () => ({
          getTools: () => ({ malformed: {} }),
          getSystemPrompt: () => 'Canvas system prompt',
          executeTool: vi.fn(),
          dispose,
        }),
      } as unknown as Engine,
      context: { messages: [{ role: 'user', content: 'fail setup' }] },
      role: null,
      chatSessionId: 'session-setup-error',
      history: [],
      currentAsk: 'fail setup',
      handoffNames: [],
      abortSignal: new AbortController().signal,
      executionMode: 'auto',
      onText: vi.fn(),
      modelConfig: {
        providerType: 'openai',
        provider: vi.fn(),
        model: 'faux-model',
        modelLabel: 'Faux model',
      },
      systemPrompt: 'Canvas system prompt',
      recordResponseMessages: vi.fn(),
      replaceMessages: vi.fn(),
    })).rejects.toThrow();

    expect(dispose).toHaveBeenCalledWith('');
  });

  it('syncs policy visibility after a tool execution fails', async () => {
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    const models = createModels();
    models.setProvider(faux.provider);
    let visibleAfterFailure: string[] = [];
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('unstable_tool', {}, { id: 'unstable-1' }),
        { stopReason: 'toolUse' },
      ),
      (context) => {
        visibleAfterFailure = context.tools?.map(tool => tool.name) ?? [];
        return fauxAssistantMessage('recovered');
      },
    ]);
    const backend = createPiAgentHarnessTurnBackend({
      createModelRuntime: () => ({ models, model: faux.getModel() }),
    });
    const sourceTools = {
      unstable_tool: {
        name: 'unstable_tool',
        description: 'Fails once and is then revoked by policy.',
        inputSchema: z.object({}),
        execute: vi.fn(),
      },
    };
    let visible = true;

    const result = await backend.runSegment({
      engine: {
        getTools: () => sourceTools,
        compactContext: async () => ({ didCompact: false }),
        createToolSession: async () => ({
          getRegisteredTools: () => sourceTools,
          getTools: () => visible ? sourceTools : {},
          getSystemPrompt: () => 'Canvas system prompt',
          executeTool: async () => {
            visible = false;
            throw new Error('tool failed');
          },
          dispose: vi.fn(),
        }),
      } as unknown as Engine,
      context: { messages: [{ role: 'user', content: 'run unstable tool' }] },
      role: null,
      chatSessionId: 'session-tool-error-policy',
      history: [],
      currentAsk: 'run unstable tool',
      handoffNames: [],
      abortSignal: new AbortController().signal,
      executionMode: 'auto',
      onText: vi.fn(),
      modelConfig: {
        providerType: 'openai',
        provider: vi.fn(),
        model: 'faux-model',
        modelLabel: 'Faux model',
      },
      systemPrompt: 'Canvas system prompt',
      recordResponseMessages: vi.fn(),
      replaceMessages: vi.fn(),
    });

    expect(result.resultText).toBe('recovered');
    expect(visibleAfterFailure).not.toContain('unstable_tool');
  });

  it('serializes multiple pi tool calls through the stateful policy session', async () => {
    const faux = fauxProvider({ tokensPerSecond: 10_000 });
    const models = createModels();
    models.setProvider(faux.provider);
    faux.setResponses([
      fauxAssistantMessage([
        fauxToolCall('first_tool', {}, { id: 'first-1' }),
        fauxToolCall('second_tool', {}, { id: 'second-1' }),
      ], { stopReason: 'toolUse' }),
      fauxAssistantMessage('both complete'),
    ]);
    const backend = createPiAgentHarnessTurnBackend({
      createModelRuntime: () => ({ models, model: faux.getModel() }),
    });
    const sourceTools = Object.fromEntries(['first_tool', 'second_tool'].map(name => [name, {
      name,
      description: `${name} description`,
      inputSchema: z.object({}),
      execute: vi.fn(),
    }]));
    let inFlight = 0;
    let maxInFlight = 0;
    const executionOrder: string[] = [];

    const result = await backend.runSegment({
      engine: {
        getTools: () => sourceTools,
        compactContext: async () => ({ didCompact: false }),
        createToolSession: async () => ({
          getRegisteredTools: () => sourceTools,
          getTools: () => sourceTools,
          getSystemPrompt: () => 'Canvas system prompt',
          executeTool: async (name: string) => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            executionOrder.push(`start:${name}`);
            await new Promise(resolve => setTimeout(resolve, 5));
            executionOrder.push(`end:${name}`);
            inFlight -= 1;
            return name;
          },
          dispose: vi.fn(),
        }),
      } as unknown as Engine,
      context: { messages: [{ role: 'user', content: 'run both' }] },
      role: null,
      chatSessionId: 'session-sequential-tools',
      history: [],
      currentAsk: 'run both',
      handoffNames: [],
      abortSignal: new AbortController().signal,
      executionMode: 'auto',
      onText: vi.fn(),
      modelConfig: {
        providerType: 'openai',
        provider: vi.fn(),
        model: 'faux-model',
        modelLabel: 'Faux model',
      },
      systemPrompt: 'Canvas system prompt',
      recordResponseMessages: vi.fn(),
      replaceMessages: vi.fn(),
    });

    expect(result.resultText).toBe('both complete');
    expect(maxInFlight).toBe(1);
    expect(executionOrder).toEqual([
      'start:first_tool', 'end:first_tool',
      'start:second_tool', 'end:second_tool',
    ]);
  });
});
