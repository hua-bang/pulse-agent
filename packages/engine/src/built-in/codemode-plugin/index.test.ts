import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { jsonSchema } from 'ai';
import { Engine } from '../../Engine.js';
import type { EnginePlugin } from '../../plugin/EnginePlugin.js';
import type { Tool } from '../../shared/types.js';
import { createCodemodePlugin } from './index.js';
import { createToolOffloadPlugin } from '../tool-offload-plugin/index.js';
import { builtInToolSearchPlugin } from '../tool-search-plugin/index.js';

const { streamMock } = vi.hoisted(() => ({ streamMock: vi.fn() }));
vi.mock('../../ai', () => ({ streamTextAI: streamMock }));
vi.mock('../../context', () => ({ maybeCompactContext: vi.fn(async () => ({ didCompact: false })) }));

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  streamMock.mockReset();
  vi.unstubAllEnvs();
});

async function engineWith(tools: Record<string, Tool>, plugins: EnginePlugin[] = []) {
  const engine = new Engine({
    disableBuiltInPlugins: true,
    builtInTools: {},
    tools,
    enginePlugins: { plugins: [...plugins, createCodemodePlugin({ allowedTools: Object.keys(tools) })], scan: false },
    userConfigPlugins: { scan: false },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  await engine.initialize();
  return engine;
}

const query = (execute: Tool['execute']): Tool => ({
  name: 'query', description: 'Read values', inputSchema: z.object({ value: z.number() }), execute,
});

describe('Codemode Engine plugin', () => {
  it('uses hooks once per nested call without extra model lifecycles or history', async () => {
    const beforeRun = vi.fn();
    const beforeLLMCall = vi.fn();
    const afterLLMCall = vi.fn();
    const afterRun = vi.fn();
    const beforeTool = vi.fn(({ name, input, toolContext }) => name === 'query'
      ? { input: { value: input.value + 1 }, toolContext: { ...toolContext, runContext: { ...toolContext.runContext, marker: true } } }
      : undefined);
    const afterTool = vi.fn(({ name, output }) => name === 'query' ? { output: output * 2 } : undefined);
    const execute = vi.fn(async input => input.value);
    const engine = await engineWith({ query: query(execute) }, [{
      name: 'hooks', version: '1', async initialize(ctx) {
        ctx.registerHook('beforeRun', beforeRun);
        ctx.registerHook('beforeLLMCall', beforeLLMCall);
        ctx.registerHook('afterLLMCall', afterLLMCall);
        ctx.registerHook('afterRun', afterRun);
        ctx.registerHook('beforeToolCall', beforeTool);
        ctx.registerHook('afterToolCall', afterTool);
      },
    }]);
    const events = vi.fn();
    engine.events.on('codemodeTool', events);
    const session = await engine.createToolSession({ messages: [] }, { runContext: { scope: 'one' } });
    try {
      const result = await session.executeTool('codemode', { code: 'return [await tools.query({value: 1}), await tools.query({value: 2})];' }, { toolCallId: 'outer' });
      expect(result).toMatchObject({ ok: true, value: [4, 6] });
      expect(beforeRun).toHaveBeenCalledTimes(1);
      expect(beforeLLMCall).toHaveBeenCalledTimes(2); // Initial and real outer result only.
      expect(afterLLMCall).toHaveBeenCalledTimes(1);
      expect(beforeTool).toHaveBeenCalledTimes(3);
      expect(afterTool).toHaveBeenCalledTimes(3);
      expect(execute.mock.calls[0][1]).toMatchObject({
        resultTarget: 'script', parentToolCallId: 'outer', toolCallId: 'outer:1',
        runContext: { scope: 'one', marker: true },
      });
      expect(events).toHaveBeenCalledTimes(6);
      // Only the outer result appears in the policy transcript seen by hooks.
      const context = beforeLLMCall.mock.calls[1][0].context;
      expect(context.messages).toHaveLength(1);
      expect(context.messages[0].content[0].toolName).toBe('codemode');
    } finally { await session.dispose(); }
    expect(afterRun).toHaveBeenCalledTimes(1);
  });

  it('checks schemas and reports synthetic policy results as intercepted', async () => {
    const execute = vi.fn(async () => 'must not execute');
    const engine = await engineWith({ query: query(execute) }, [{
      name: 'deny', version: '1', async initialize(ctx) {
        ctx.registerHook('beforeToolCall', ({ name }) => name === 'query' ? { output: { denied: true } } : undefined);
      },
    }]);
    const session = await engine.createToolSession({ messages: [] });
    try {
      const invalid: any = await session.executeTool('codemode', { code: 'await tools.query({value: "bad"});' });
      expect(invalid.ok).toBe(false);
      expect(invalid.calls[0].error).toContain('Invalid input');
      const denied: any = await session.executeTool('codemode', { code: 'return await tools.query({value: 1});' });
      expect(denied.value).toEqual({ denied: true });
      expect(denied.calls[0].status).toBe('intercepted');
      expect(execute).not.toHaveBeenCalled();
    } finally { await session.dispose(); }
  });

  it('enforces caller rules without the PTC plugin and cannot recurse', async () => {
    const execute = vi.fn(async () => 'secret');
    const engine = await engineWith({ query: { ...query(execute), allowed_callers: ['trusted'] } });
    const session = await engine.createToolSession({ messages: [] }, { runContext: { caller: 'untrusted' } });
    try {
      const result: any = await session.executeTool('codemode', { code: 'text(ALL_TOOLS); return typeof tools.codemode;' });
      expect(result).toMatchObject({ ok: true, output: ['[]'], value: 'undefined' });
      expect(execute).not.toHaveBeenCalled();
    } finally { await session.dispose(); }
    const trusted = await engine.createToolSession({ messages: [] }, { runContext: { caller: 'TRUSTED' } });
    try {
      expect(await trusted.executeTool('codemode', { code: 'return await tools.query({value: 1});' })).toMatchObject({ ok: true, value: 'secret' });
    } finally { await trusted.dispose(); }
  });

  it('validates MCP-style JSON schemas before executing nested tools', async () => {
    const execute = vi.fn(async () => 1);
    const engine = await engineWith({ query: {
      ...query(execute),
      inputSchema: jsonSchema({
        type: 'object', properties: { value: { type: 'number' } }, required: ['value'], additionalProperties: false,
      }),
    } });
    const session = await engine.createToolSession({ messages: [] });
    try {
      const result: any = await session.executeTool('codemode', { code: 'await tools.query({value: "bad"});' });
      expect(result.ok).toBe(false);
      expect(result.calls[0].error).toContain('Invalid input');
      expect(execute).not.toHaveBeenCalled();
    } finally { await session.dispose(); }
  });

  it('inherits authority after the outer policy hook narrows caller context', async () => {
    const execute = vi.fn(async () => 'secret');
    const engine = await engineWith({ query: { ...query(execute), allowed_callers: ['trusted'] } }, [{
      name: 'narrow-caller', version: '1', async initialize(ctx) {
        ctx.registerHook('beforeToolCall', ({ name, toolContext }) => name === 'codemode'
          ? { toolContext: { ...toolContext, runContext: { caller: 'untrusted' } } }
          : undefined);
      },
    }]);
    const session = await engine.createToolSession({ messages: [] }, { runContext: { caller: 'trusted' } });
    try {
      const result: any = await session.executeTool('codemode', { code: 'text(ALL_TOOLS); await tools.query({value: 1});' });
      expect(result.output).toEqual(['[]']);
      expect(result.ok).toBe(false);
      expect(execute).not.toHaveBeenCalled();
    } finally { await session.dispose(); }
  });

  it('isolates tool schemas that declare the same JSON Schema ID', async () => {
    const schema = () => jsonSchema({
      $id: 'shared-tool-schema', type: 'object', properties: { value: { type: 'number' } }, required: ['value'],
    });
    const engine = await engineWith({
      first: { ...query(async input => input.value), name: 'first', inputSchema: schema() },
      second: { ...query(async input => input.value + 1), name: 'second', inputSchema: schema() },
    });
    const session = await engine.createToolSession({ messages: [] });
    try {
      expect(await session.executeTool('codemode', {
        code: 'return [await tools.first({value: 1}), await tools.second({value: 1})];',
      })).toMatchObject({ ok: true, value: [1, 2] });
    } finally { await session.dispose(); }
  });

  it('enforces conditional constraints and local references in JSON schemas', async () => {
    const execute = vi.fn(async input => input.value);
    const engine = await engineWith({ query: {
      ...query(execute), inputSchema: jsonSchema({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object', $defs: { positive: { type: 'number', minimum: 0 } },
        properties: { value: { $ref: '#/$defs/positive' }, bounded: { type: 'boolean' } },
        required: ['value', 'bounded'],
        if: { properties: { bounded: { const: true } } },
        then: { properties: { value: { maximum: 10 } } },
      }),
    } });
    const session = await engine.createToolSession({ messages: [] });
    try {
      expect(await session.executeTool('codemode', { code: 'return await tools.query({value: 8, bounded: true});' })).toMatchObject({ ok: true, value: 8 });
      expect(await session.executeTool('codemode', { code: 'await tools.query({value: 11, bounded: true});' })).toMatchObject({ ok: false });
      expect(await session.executeTool('codemode', { code: 'await tools.query({value: -1, bounded: false});' })).toMatchObject({ ok: false });
      expect(execute).toHaveBeenCalledTimes(1);
    } finally { await session.dispose(); }
  });

  it('rejects an input matching multiple oneOf branches', async () => {
    const execute = vi.fn(async input => input.value);
    const engine = await engineWith({ query: {
      ...query(execute), inputSchema: jsonSchema({
        type: 'object', properties: { value: { oneOf: [{ type: 'number' }, { type: 'integer' }] } }, required: ['value'],
      }),
    } });
    const session = await engine.createToolSession({ messages: [] });
    try {
      expect(await session.executeTool('codemode', { code: 'await tools.query({value: 5});' })).toMatchObject({ ok: false });
      expect(execute).not.toHaveBeenCalled();
    } finally { await session.dispose(); }
  });

  it('accepts valid redundant constraints and annotations without weakening const/enum', async () => {
    for (const test of [
      { schema: { type: 'string', const: 'a', enum: ['a', 'b'] }, value: 'a', valid: true },
      { schema: { type: 'string', const: 'a', enum: ['b'] }, value: 'a', valid: false },
      { schema: { type: 'array', additionalItems: false }, value: [1, 2], valid: true },
      { schema: { type: 'string', contentMediaType: 'text/plain' }, value: 'hello', valid: true },
    ]) {
      const execute = vi.fn(async input => input.value);
      const engine = await engineWith({ query: {
        ...query(execute), inputSchema: jsonSchema({
          type: 'object', properties: { value: test.schema }, required: ['value'],
        }),
      } });
      const session = await engine.createToolSession({ messages: [] });
      try {
        const result: any = await session.executeTool('codemode', {
          code: `return await tools.query({value: ${JSON.stringify(test.value)}});`,
        });
        expect(result.ok).toBe(test.valid);
        expect(execute).toHaveBeenCalledTimes(test.valid ? 1 : 0);
      } finally { await session.dispose(); }
    }
  });

  it('allows explicitly reviewed deferred tools without a model search step', async () => {
    vi.stubEnv('PULSE_CODER_TOOL_SEARCH_THRESHOLD', '0');
    const engine = await engineWith({ query: { ...query(async () => 42), defer_loading: true } }, [builtInToolSearchPlugin]);
    const session = await engine.createToolSession({ messages: [] });
    try {
      const hidden: any = await session.executeTool('codemode', { code: 'text(ALL_TOOLS); await tools.query({value: 1});' });
      expect(hidden.ok).toBe(true);
      expect(hidden.output[0]).toContain('query');
      await session.executeTool('tool_search_tool_bm25', { query: 'Read values' });
      const loaded: any = await session.executeTool('codemode', { code: 'return await tools.query({value: 1});' });
      expect(loaded).toMatchObject({ ok: true, value: 42 });
    } finally { await session.dispose(); }
  });

  it('defaults marked MCP tools to script access, without trusting name prefixes', async () => {
    vi.stubEnv('PULSE_CODER_TOOL_SEARCH_THRESHOLD', '0');
    const engine = new Engine({
      disableBuiltInPlugins: true, builtInTools: {},
      tools: {
        mcp_real: { ...query(async () => 42), codemode: true, defer_loading: true },
        mcp_fake: query(async () => 'fake'),
        opted_out: { ...query(async () => 'denied'), codemode: false },
      },
      enginePlugins: { plugins: [builtInToolSearchPlugin, createCodemodePlugin({ allowedTools: ['opted_out'] })], scan: false },
      userConfigPlugins: { scan: false },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    });
    await engine.initialize();
    const session = await engine.createToolSession({ messages: [] });
    try {
      expect(session.getTools()).not.toHaveProperty('mcp_real');
      expect(await session.executeTool('codemode', {
        code: 'return [await tools.mcp_real({value: 1}), typeof tools.mcp_fake, typeof tools.opted_out];',
      })).toMatchObject({ ok: true, value: [42, 'undefined', 'undefined'] });
    } finally { await session.dispose(); }
  });

  it.each(['session', 'native'])('preserves policy removal and execution wrappers in %s', async mode => {
    vi.stubEnv('PULSE_CODER_TOOL_SEARCH_THRESHOLD', '0');
    const forbidden = vi.fn(async () => 'must not run');
    const engine = await engineWith({
      query: { ...query(forbidden), codemode: true, defer_loading: true },
      denied: { ...query(forbidden), codemode: true, defer_loading: true },
    }, [builtInToolSearchPlugin, {
      name: 'policy', version: '1', async initialize(ctx) {
        ctx.registerHook('beforeLLMCall', ({ tools }) => {
          const { denied, ...permitted } = tools;
          return { tools: { ...permitted, query: { ...permitted.query, execute: async () => ({ approvalDenied: true }) } } };
        });
        // Presentation must neither resurrect tools nor substitute policy execution.
        ctx.registerHook('prepareToolPresentation', ({ tools }) => ({ tools: {
          ...tools, denied: query(forbidden), query: query(forbidden),
        } }));
      },
    }]);
    const code = 'return [await tools.query({value: 1}), typeof tools.denied];';
    if (mode === 'session') {
      const session = await engine.createToolSession({ messages: [] });
      try {
        expect(session.getTools()).not.toHaveProperty('denied');
        expect(await session.executeTool('codemode', { code })).toMatchObject({ ok: true, value: [{ approvalDenied: true }, 'undefined'] });
      } finally { await session.dispose(); }
    } else {
      streamMock.mockImplementation((_messages, tools, options) => {
        expect(tools).not.toHaveProperty('denied');
        const text = tools.codemode.execute({ code }, options.toolExecutionContext).then(JSON.stringify);
        return { text, steps: Promise.resolve([]), finishReason: Promise.resolve('stop'), usage: Promise.resolve({}) };
      });
      expect(JSON.parse(await engine.run({ messages: [] }))).toMatchObject({ ok: true, value: [{ approvalDenied: true }, 'undefined'] });
    }
    expect(forbidden).not.toHaveBeenCalled();
  });

  it('keeps beforeRun scope removals out of script discovery', async () => {
    const execute = vi.fn(async () => 'out of scope');
    const engine = await engineWith({ query: { ...query(execute), codemode: true } }, [{
      name: 'scope', version: '1', async initialize(ctx) {
        ctx.registerHook('beforeRun', ({ tools }) => {
          const { query, ...scoped } = tools;
          return { tools: scoped };
        });
      },
    }]);
    const session = await engine.createToolSession({ messages: [] });
    try {
      expect(await session.executeTool('codemode', { code: 'return ALL_TOOLS;' })).toMatchObject({ ok: true, value: [] });
      expect(execute).not.toHaveBeenCalled();
    } finally { await session.dispose(); }
  });

  it('gives scripts policy-processed large results while offloading direct results', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'codemode-offload-'));
    dirs.push(dir);
    const rows = Array.from({ length: 100 }, () => ({ value: 'x'.repeat(100) }));
    const engine = await engineWith({ query: query(async () => rows) }, [createToolOffloadPlugin({ dir, threshold: 1000 })]);
    const session = await engine.createToolSession({ messages: [] });
    try {
      const aggregate: any = await session.executeTool('codemode', { code: 'return (await tools.query({value: 1})).length;' });
      expect(aggregate).toMatchObject({ ok: true, value: 100 });
      const direct = await session.executeTool('query', { value: 1 });
      expect(JSON.stringify(direct)).toContain('offload');
    } finally { await session.dispose(); }
  });

  it('runs on the native loop using the same policy boundary', async () => {
    const execute = vi.fn(async input => input.value);
    const engine = await engineWith({ query: query(execute) });
    streamMock.mockImplementation((_messages, tools, options) => {
      const text = tools.codemode.execute({ code: 'return await tools.query({value: 7});' }, {
        ...options.toolExecutionContext, toolCallId: 'native',
      }).then((result: any) => JSON.stringify(result));
      return { text, steps: Promise.resolve([]), finishReason: Promise.resolve('stop'), usage: Promise.resolve({}) };
    });
    const result = await engine.run({ messages: [{ role: 'user', content: 'query' }] }, { systemPrompt: 'test', runContext: { scope: 'native' } });
    expect(JSON.parse(result)).toMatchObject({ ok: true, value: 7 });
    expect(execute.mock.calls[0][1]).toMatchObject({ parentToolCallId: 'native', runContext: { scope: 'native' } });
  });
});
