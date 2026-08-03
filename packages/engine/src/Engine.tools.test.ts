import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { Engine } from './Engine.js';
import { ReadTool } from './tools/index.js';
import { builtInToolSearchPlugin } from './built-in/tool-search-plugin/index.js';
import { builtInPtcPlugin } from './built-in/ptc-plugin/index.js';

const createLogger = () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
});

describe('Engine built-in tool policy', () => {
  it('lets a host replace the built-in tool set while preserving custom tools', async () => {
    const engine = new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: { scan: false },
      userConfigPlugins: { scan: false },
      builtInTools: { read: ReadTool },
      tools: {
        host_answer: {
          name: 'host_answer',
          description: 'Answer a host-specific question.',
          inputSchema: z.object({ question: z.string() }),
          execute: async ({ question }: { question: string }) => question,
        },
      },
      logger: createLogger(),
    });

    await engine.initialize();

    expect(Object.keys(engine.getTools()).sort()).toEqual(['host_answer', 'read']);
  });

  it('executes a selected tool through the same before/after hook chain', async () => {
    const execute = vi.fn(async ({ question }: { question: string }) => `answer:${question}`);
    const beforeRun = vi.fn();
    const beforeLLMCall = vi.fn();
    const afterLLMCall = vi.fn();
    const afterRun = vi.fn();
    const plugin = {
      name: 'test/tool-hooks',
      version: '1.0.0',
      async initialize(context: any) {
        context.registerHook('beforeRun', beforeRun);
        context.registerHook('beforeLLMCall', beforeLLMCall);
        context.registerHook('afterLLMCall', afterLLMCall);
        context.registerHook('afterRun', afterRun);
        context.registerHook('beforeToolCall', async ({ input, toolContext }: any) => ({
          input: { question: `${input.question}-before` },
          toolContext: { ...toolContext, marker: 'hooked' },
        }));
        context.registerHook('afterToolCall', async ({ output }: any) => ({
          output: `${output}-after`,
        }));
      },
    };
    const engine = new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: { plugins: [plugin], scan: false },
      userConfigPlugins: { scan: false },
      builtInTools: {},
      tools: {
        host_answer: {
          name: 'host_answer',
          description: 'Answer a host-specific question.',
          inputSchema: z.object({ question: z.string() }),
          execute,
        },
      },
      logger: createLogger(),
    });
    await engine.initialize();

    const session = await engine.createToolSession({ messages: [] });
    const output = await session.executeTool(
      'host_answer',
      { question: 'hello' },
      { runContext: { executionMode: 'ask' } },
    );

    expect(output).toBe('answer:hello-before-after');
    expect(execute).toHaveBeenCalledWith(
      { question: 'hello-before' },
      expect.objectContaining({ marker: 'hooked' }),
    );
    await session.dispose('done');
    expect(beforeRun).toHaveBeenCalledTimes(1);
    expect(beforeLLMCall).toHaveBeenCalledTimes(2);
    expect(afterLLMCall).toHaveBeenCalledTimes(2);
    expect(afterRun).toHaveBeenCalledWith(expect.objectContaining({ result: 'done' }));
  });

  it('rejects invalid direct tool input before execution', async () => {
    const execute = vi.fn();
    const engine = new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: { scan: false },
      userConfigPlugins: { scan: false },
      builtInTools: {},
      tools: {
        host_answer: {
          name: 'host_answer',
          description: 'Answer a host-specific question.',
          inputSchema: z.object({ question: z.string() }),
          execute,
        },
      },
      logger: createLogger(),
    });
    await engine.initialize();

    const session = await engine.createToolSession({ messages: [] });
    await expect(session.executeTool('host_answer', { question: 42 }))
      .rejects.toThrow(/invalid input/i);
    expect(execute).not.toHaveBeenCalled();
    await session.dispose();
  });

  it('closes the run lifecycle when session initialization or LLM close fails', async () => {
    const initAfterRun = vi.fn();
    const initEngine = new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: {
        scan: false,
        plugins: [{
          name: 'test/init-lifecycle',
          version: '1.0.0',
          async initialize(context: any) {
            context.registerHook('beforeLLMCall', () => {
              throw new Error('initial visibility failed');
            });
            context.registerHook('afterRun', initAfterRun);
          },
        }],
      },
      userConfigPlugins: { scan: false },
      builtInTools: {},
      logger: createLogger(),
    });
    await initEngine.initialize();
    await expect(initEngine.createToolSession({ messages: [] }))
      .rejects.toThrow('initial visibility failed');
    expect(initAfterRun).toHaveBeenCalledTimes(1);

    const closeAfterRun = vi.fn();
    const closeEngine = new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: {
        scan: false,
        plugins: [{
          name: 'test/close-lifecycle',
          version: '1.0.0',
          async initialize(context: any) {
            context.registerHook('afterLLMCall', () => {
              throw new Error('close failed');
            });
            context.registerHook('afterRun', closeAfterRun);
          },
        }],
      },
      userConfigPlugins: { scan: false },
      builtInTools: {},
      logger: createLogger(),
    });
    await closeEngine.initialize();
    const session = await closeEngine.createToolSession({ messages: [] });
    await expect(session.dispose()).rejects.toThrow('close failed');
    expect(closeAfterRun).toHaveBeenCalledTimes(1);
  });

  it('keeps deferred tools hidden until an external tool session searches for them', async () => {
    const deferredExecute = vi.fn(async () => 'created');
    const engine = new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: { plugins: [builtInToolSearchPlugin], scan: false },
      userConfigPlugins: { scan: false },
      builtInTools: {},
      tools: {
        immediate_read: {
          name: 'immediate_read',
          description: 'Read immediate context.',
          inputSchema: z.object({}),
          execute: async () => 'read',
        },
        artifact_create: {
          name: 'artifact_create',
          description: 'Create an artifact.',
          inputSchema: z.object({ title: z.string() }),
          execute: deferredExecute,
          defer_loading: true,
        },
      },
      logger: createLogger(),
    });
    await engine.initialize();

    const session = await engine.createToolSession({ messages: [] });
    expect(Object.keys(session.getTools())).toEqual(expect.arrayContaining([
      'immediate_read',
      'tool_search_tool_bm25',
    ]));
    expect(session.getTools()).not.toHaveProperty('artifact_create');
    await expect(session.executeTool('artifact_create', { title: 'Early' }))
      .rejects.toThrow(/unavailable/i);

    const searchResult = await session.executeTool('tool_search_tool_bm25', {
      query: 'create artifact',
    }, { toolCallId: 'search-1' });
    expect(searchResult).toMatchObject({
      tool_references: [{ tool_name: 'artifact_create' }],
    });
    expect(session.getTools()).toHaveProperty('artifact_create');
    await expect(session.executeTool('artifact_create', { title: 'Ready' }))
      .resolves.toBe('created');
    await session.dispose('done');
  });

  it('applies PTC visibility and runtime restrictions to external tool sessions', async () => {
    const engine = new Engine({
      disableBuiltInPlugins: true,
      enginePlugins: {
        plugins: [{ ...builtInPtcPlugin, version: `${builtInPtcPlugin.version}-tool-session` }],
        scan: false,
      },
      userConfigPlugins: { scan: false },
      builtInTools: {},
      tools: {
        guarded_tool: {
          name: 'guarded_tool',
          description: 'Caller-restricted tool.',
          inputSchema: z.object({}),
          allowed_callers: ['trusted_caller'],
          execute: async () => 'ok',
        },
      },
      logger: createLogger(),
    });
    await engine.initialize();

    const blocked = await engine.createToolSession(
      { messages: [] },
      { runContext: { callerSelectors: ['other_caller'] } },
    );
    expect(blocked.getTools()).not.toHaveProperty('guarded_tool');
    await blocked.dispose();

    const allowed = await engine.createToolSession(
      { messages: [] },
      { runContext: { callerSelectors: ['trusted_caller'] } },
    );
    expect(allowed.getTools()).toHaveProperty('guarded_tool');
    await expect(allowed.executeTool('guarded_tool', {}, {
      runContext: { callerSelectors: ['other_caller'] },
    })).rejects.toThrow(/not allowed/i);
    await allowed.dispose();
  });
});
