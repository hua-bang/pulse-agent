import { describe, expect, it, vi } from 'vitest';
import { runCodemode } from './runtime.js';

const run = (code: string, overrides: Partial<Parameters<typeof runCodemode>[0]> = {}) => runCodemode({
  code,
  parentToolCallId: 'outer',
  catalog: [{ name: 'query', description: 'Read records', inputSchema: {} }],
  executeTool: async () => [{ label: 'a', amount: 5 }, { label: 'b', amount: 7 }],
  ...overrides,
});

describe('Codemode isolated runtime', () => {
  it('aggregates tool results without outputting intermediate records', async () => {
    const result = await run(`
      const rows = await tools.query({});
      text(rows.reduce((sum, row) => sum + row.amount, 0));
      return rows.length;
    `);
    expect(result).toMatchObject({ ok: true, output: ['12'], value: 2 });
    expect(result.calls).toEqual([expect.objectContaining({ id: 'outer:1', name: 'query', status: 'succeeded' })]);
    expect(JSON.stringify(result)).not.toContain('"label"');
  });

  it('provides schema discovery without host globals or hidden tools', async () => {
    const result = await run(`
      text([typeof process, typeof require, typeof fetch, typeof __bridge]);
      text(ALL_TOOLS);
      return describeTools(['query'])[0].inputSchema;
    `);
    expect(result.ok).toBe(true);
    expect(result.output[0]).toBe('["undefined","undefined","undefined","undefined"]');
    expect(result.value).toEqual({});
    const hidden = await run('await tools.secret({});');
    expect(hidden.ok).toBe(false);
    expect(hidden.calls).toEqual([]);
  });

  it('includes executable tool references in discovery, including punctuated MCP names', async () => {
    const name = 'mcp_bits-and-bolts_cad_search';
    const result = await run(`
      const entry = ALL_TOOLS.find(item => item.name === '${name}');
      const description = describeTools([entry.name])[0];
      return { listed: entry.callExpression, described: description.callExpression };
    `, { catalog: [{ name, description: 'Search parts', inputSchema: {} }] });
    expect(result).toMatchObject({ ok: true, value: {
      listed: 'tools["mcp_bits-and-bolts_cad_search"]',
      described: 'tools["mcp_bits-and-bolts_cad_search"]',
    } });
  });

  it('explains bare tool names without executing or retrying the screenshot script', async () => {
    const executeTool = vi.fn(async () => 'context');
    const catalog = [{ name: 'canvas_read_context', description: 'Read canvas', inputSchema: {} }];
    const failed = await run(`
      const ctx = await canvas_read_context({ detail: 'full' });
      text(typeof ctx === 'string' ? ctx.slice(0, 500) : JSON.stringify(Object.keys(ctx)));
    `, { catalog, executeTool });
    expect(failed.ok).toBe(false);
    expect(failed.error).toContain('tools["canvas_read_context"]');
    expect(failed.calls).toEqual([]);
    expect(executeTool).not.toHaveBeenCalled();
    expect(await run('return await tools.canvas_read_context({ detail: "full" });', {
      catalog, executeTool,
    })).toMatchObject({ ok: true, value: 'context' });
    expect(executeTool).toHaveBeenCalledTimes(1);
    const unrelated = await run('return other_missing_name;', { catalog });
    expect(unrelated.error).not.toContain('tools["canvas_read_context"]');
  });

  it('serializes Promise.all tool calls', async () => {
    let live = 0;
    let peak = 0;
    const executeTool = vi.fn(async () => {
      peak = Math.max(peak, ++live);
      await new Promise(resolve => setTimeout(resolve, 10));
      live--;
      return executeTool.mock.calls.length;
    });
    const result = await run('return await Promise.all([tools.query({}), tools.query({}), tools.query({})]);', { executeTool });
    expect(result.ok).toBe(true);
    expect(peak).toBe(1);
    expect(executeTool).toHaveBeenCalledTimes(3);
  });

  it('lets scripts catch errors and retains partial output on failure', async () => {
    const caught = await run('try { await tools.query({}); } catch (e) { return e.message; }', {
      executeTool: async () => { throw new Error('query failed'); },
    });
    expect(caught).toMatchObject({ ok: true, value: 'Error: query failed' });
    expect(caught.calls[0].status).toBe('failed');
    const failed = await run('text("before"); await tools.query({}); throw new Error("after");');
    expect(failed).toMatchObject({ ok: false, output: ['before'] });
    expect(failed.calls[0].status).toBe('succeeded');
    expect(failed.error).toContain('completed calls were not undone');
  });

  it('terminates a synchronous and a microtask infinite loop', async () => {
    for (const code of ['while (true) {}', 'while (true) await null;']) {
      const start = Date.now();
      const result = await run(code, { timeoutMs: 250 });
      expect(result.ok).toBe(false);
      expect(Date.now() - start).toBeLessThan(2000);
    }
  });

  it('cancels in-flight tools and does not start queued work after abort', async () => {
    const controller = new AbortController();
    let signal: AbortSignal | undefined;
    const executeTool = vi.fn(async (_name, _input, toolSignal) => {
      signal = toolSignal;
      controller.abort();
      await new Promise(() => {});
    });
    const result = await run('await Promise.all([tools.query({}), tools.query({})]);', { signal: controller.signal, executeTool });
    expect(result.ok).toBe(false);
    expect(signal?.aborted).toBe(true);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result.calls.every(call => call.status === 'cancelled')).toBe(true);
  });

  it('cleans up unawaited calls and detects an unresolvable promise', async () => {
    const result = await run('tools.query({}); return "done";', { executeTool: async () => new Promise(() => {}) });
    expect(result.ok).toBe(true);
    expect(result.calls[0].status).toBe('cancelled');
    const stuck = await run('await new Promise(() => {});');
    expect(stuck.ok).toBe(false);
    expect(stuck.error).toContain('without a pending tool call');
  });

  it('enforces source, output, call and result limits', async () => {
    expect((await run(' '.repeat(65537))).error).toContain('source limit');
    expect((await run('text("x".repeat(30001));')).ok).toBe(false);
    expect((await run('return "x".repeat(30001);')).ok).toBe(false);
    expect((await run('for (let i=0;i<101;i++) await tools.query({});')).ok).toBe(false);
    const oversized = await run('await tools.query({});', { executeTool: async () => 'x'.repeat(2 * 1024 * 1024) });
    expect(oversized.ok).toBe(false);
    expect(oversized.calls[0].error).toContain('result limit');
    const unserializable = await run('await tools.query({});', { executeTool: async () => BigInt(1) });
    expect(unserializable.ok).toBe(false);
  });

  it('isolates simultaneous executions and supports Unicode', async () => {
    const results = await Promise.all([
      run('globalThis.secret = 1; text("中文🙂"); return await tools.query({});', { executeTool: async () => 'one' }),
      run('text(typeof secret); return await tools.query({});', { executeTool: async () => 'two' }),
    ]);
    expect(results[0]).toMatchObject({ ok: true, output: ['中文🙂'], value: 'one' });
    expect(results[1]).toMatchObject({ ok: true, output: ['undefined'], value: 'two' });
  });

  it('enforces VM memory limits and handles syntax errors', async () => {
    const allocation = await run('return new Array(1000000).fill("x");', { memoryLimitBytes: 1024 * 1024 });
    expect(allocation.ok).toBe(false);
    expect(allocation.error).toMatch(/memory|allocation|worker/i);
    expect((await run('const = ;')).ok).toBe(false);
  });

  it('keeps constructor-generated code inside the guest VM', async () => {
    const result = await run('return tools.query.constructor("return typeof process")();');
    expect(result).toMatchObject({ ok: true, value: 'undefined' });
  });

  it('rejects oversized UTF-8 arguments before they enter a blocked host queue', async () => {
    for (const payload of ['"x".repeat(4 * 1024 * 1024)', '"中".repeat(30000)']) {
      const executeTool = vi.fn(async () => new Promise(() => {}));
      const result = await run(`
        tools.query({});
        try { await tools.query({payload: ${payload}}); }
        catch (error) { text(error.message); }
      `, { executeTool, timeoutMs: 1000 });
      expect(result.ok).toBe(true);
      expect(result.output[0]).toContain('argument limit');
      expect(result.calls).toHaveLength(1);
      expect(executeTool).toHaveBeenCalledTimes(1);
    }
  });

  it('bounds queued arguments even when the first authorized tool never settles', async () => {
    const executeTool = vi.fn(async () => new Promise(() => {}));
    const result = await run(`
      tools.query({});
      for (let i = 0; i < 25; i++) tools.query({payload: 'x'.repeat(60000)}).catch(error => text(error.message));
    `, { executeTool });
    expect(result.ok).toBe(true);
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result.calls.some(call => call.error?.includes('queue limit'))).toBe(true);
  });
});
