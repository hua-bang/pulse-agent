import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMCPClient, type MCPTransport } from '@ai-sdk/mcp';
import { MockLanguageModelV3 } from 'ai/test';
import { loop } from '../../core/loop';
import type { Context, Tool } from '../../shared/types';
import { offloadToolOutput, type OffloadStore } from './offload';

vi.mock('../../context', () => ({
  maybeCompactContext: vi.fn(async () => ({ didCompact: false })),
}));

// Real MCP client/converter, with only the wire and model replaced. No network.
async function makeTool(output: unknown) {
  const transport: MCPTransport = {
    async start() {},
    async close() { transport.onclose?.(); },
    async send(message) {
      if (!('id' in message) || !('method' in message)) return;
      const result = message.method === 'initialize'
        ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } }
        : message.method === 'tools/list'
          ? { tools: [{ name: 'search', description: 'Search fixture', inputSchema: { type: 'object', properties: {} } }] }
          : output;
      transport.onmessage?.({ jsonrpc: '2.0', id: message.id, result });
    },
  };
  const client = await createMCPClient({ transport });
  return { client, tool: (await client.tools()).search };
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
function model() {
  const responses = [
      {
        stream: new ReadableStream({ start(c) {
          c.enqueue({ type: 'tool-call', toolCallId: 'call-1', toolName: 'search', input: '{}' });
          c.enqueue({ type: 'finish', finishReason: { unified: 'tool-calls', raw: 'tool-calls' }, usage });
          c.close();
        } }),
      },
      {
        stream: new ReadableStream({ start(c) {
          c.enqueue({ type: 'text-start', id: 'text-1' });
          c.enqueue({ type: 'text-delta', id: 'text-1', delta: 'continued' });
          c.enqueue({ type: 'text-end', id: 'text-1' });
          c.enqueue({ type: 'finish', finishReason: { unified: 'stop', raw: 'stop' }, usage });
          c.close();
        } }),
      },
    ];
  return new MockLanguageModelV3({ doStream: async () => responses.shift()! });
}

const controllers: AbortController[] = [];
afterEach(() => { for (const c of controllers.splice(0)) c.abort(); });

async function boundedRun(tool: Tool, hooks = {}) {
  const abort = new AbortController();
  controllers.push(abort);
  const providerModel = model();
  const events: unknown[] = [];
  const context: Context = { messages: [{ role: 'user', content: 'search' }] };
  const run = loop(context, {
    tools: { search: tool }, provider: () => providerModel,
    abortSignal: abort.signal, hooks, errorMode: 'throw',
    onToolResult: (event) => events.push(event),
    onResponse: (messages) => { context.messages.push(...messages); },
  });
  const timer = setTimeout(() => abort.abort(), 1500);
  try { return { text: await run, model: providerModel, events }; }
  finally { clearTimeout(timer); }
}

describe('MCP offload continuation (real SDK)', () => {
  it.each([false, true])('completes the next model turn with offload=%s', async (offload) => {
    const original = {
      content: [{ type: 'text', text: 'Search result\n'.repeat(4000) }],
      structuredContent: { full: 'S'.repeat(40000) },
      _meta: { trace: 'metadata' }, isError: false,
    };
    const { client, tool } = await makeTool(original);
    const files = new Map<string, string>();
    const store: OffloadStore = {
      dir: '/tmp/offload-fixture',
      async write(name, text) { files.set(name, text); return `${this.dir}/${name}`; },
    };
    try {
      const result = await boundedRun({ ...tool, name: 'search' } as Tool, offload ? {
        afterToolCall: [async ({ output }: { output: unknown }) => {
          const result = await offloadToolOutput(output, { toolName: 'search', threshold: 30000, store });
          return result ? { output: result.output } : undefined;
        }],
      } : {});
      expect(result.text).toBe('continued');
      expect(result.events).toHaveLength(1);
      expect(result.model.doStreamCalls).toHaveLength(2);
      if (offload) {
        const prompt = JSON.stringify(result.model.doStreamCalls[1].prompt);
        expect(prompt).toContain('offloaded to disk');
        expect(prompt).not.toContain('S'.repeat(40000));
        expect(JSON.parse([...files.values()][0])).toEqual(original);
      }
    } finally { await client.close(); }
  });

  it('rejects promptly if a tool converter throws after tool-result', async () => {
    const { client, tool } = await makeTool({ content: [{ type: 'text', text: 'ok' }] });
    const error = new TypeError('converter failure');
    try {
      await expect(boundedRun({ ...tool, name: 'search', toModelOutput: () => { throw error; } } as Tool))
        .rejects.toBe(error);
    } finally { await client.close(); }
  });
});
