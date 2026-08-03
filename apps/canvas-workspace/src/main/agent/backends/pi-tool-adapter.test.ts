import { jsonSchema } from 'ai';
import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';

import { adaptEngineToolsForPi } from './pi-tool-adapter';

describe('adaptEngineToolsForPi', () => {
  it('exposes eager tools initially and preserves Canvas execution context', async () => {
    const execute = vi.fn(async (_input, context) => ({ ok: true, mode: context?.runContext?.executionMode }));
    const executeTool = vi.fn(async (_name, input, context) => execute(input, context));
    const signal = new AbortController().signal;
    const onClarificationRequest = vi.fn();

    const adapted = adaptEngineToolsForPi({
      tools: {
        canvas_read_context: {
          name: 'canvas_read_context',
          description: 'Read the canvas context.',
          inputSchema: z.object({ detail: z.enum(['summary', 'full']) }),
          execute,
        },
        canvas_update_node: {
          name: 'canvas_update_node',
          description: 'Update a node.',
          inputSchema: z.object({ id: z.string() }),
          defer_loading: true,
          execute: vi.fn(),
        },
      },
      executionContext: {
        abortSignal: signal,
        onClarificationRequest,
        runContext: { executionMode: 'ask' },
      },
      executeTool,
    });

    expect(adapted.activeToolNames).toEqual(['canvas_read_context']);
    expect(adapted.tools.map(tool => tool.name)).toEqual([
      'canvas_read_context',
      'canvas_update_node',
    ]);
    expect(adapted.tools.every(tool => tool.executionMode === 'sequential')).toBe(true);

    const readTool = adapted.tools[0];
    const result = await readTool.execute('call-1', { detail: 'summary' }, signal, undefined, undefined);

    expect(executeTool).toHaveBeenCalledWith(
      'canvas_read_context',
      { detail: 'summary' },
      expect.objectContaining({
        abortSignal: signal,
        onClarificationRequest,
        runContext: { executionMode: 'ask' },
        toolCallId: 'call-1',
      }),
    );
    expect(result.content).toEqual([{ type: 'text', text: '{"ok":true,"mode":"ask"}' }]);
  });

  it('maps Engine tool-search references to pi native deferred-tool activation', async () => {
    const sourceTools = {
      tool_search_tool_bm25: {
        name: 'tool_search_tool_bm25',
        description: 'Search tools.',
        inputSchema: z.object({ query: z.string() }),
        execute: async () => ({
          type: 'tool_search_tool_search_result',
          tool_references: [
            { type: 'tool_reference', tool_name: 'canvas_update_node' },
            { type: 'tool_reference', tool_name: 'missing_tool' },
          ],
        }),
      },
      canvas_update_node: {
        name: 'canvas_update_node',
        description: 'Update a node.',
        inputSchema: z.object({ id: z.string() }),
        defer_loading: true,
        execute: vi.fn(),
      },
    };
    const adapted = adaptEngineToolsForPi({
      tools: sourceTools,
      executeTool: async (name, input, context) => {
        return sourceTools[name as keyof typeof sourceTools].execute(input as never, context as never);
      },
      executionContext: {},
    });

    const result = await adapted.tools[0].execute(
      'search-1',
      { query: 'update node' },
      undefined,
      undefined,
      undefined,
    );

    expect(result.addedToolNames).toEqual(['canvas_update_node']);
  });

  it('adapts AI SDK JSON schemas used by MCP tools', () => {
    const adapted = adaptEngineToolsForPi({
      tools: {
        mcp_deepwiki_ask_question: {
          name: 'mcp_deepwiki_ask_question',
          description: 'Ask DeepWiki.',
          inputSchema: jsonSchema({
            type: 'object',
            properties: { question: { type: 'string' } },
            required: ['question'],
          }),
          execute: vi.fn(),
        },
      },
      executeTool: vi.fn(),
      executionContext: {},
    });

    expect(adapted.tools[0].parameters).toEqual({
      type: 'object',
      properties: { question: { type: 'string' } },
      required: ['question'],
    });
  });

  it('preserves image content returned by Canvas tools', async () => {
    const adapted = adaptEngineToolsForPi({
      tools: {
        canvas_screenshot: {
          name: 'canvas_screenshot',
          description: 'Capture the canvas.',
          inputSchema: z.object({}),
          execute: vi.fn(),
        },
      },
      executeTool: async () => ({
        type: 'content',
        value: [
          { type: 'text', text: 'snapshot' },
          { type: 'image-data', data: 'aGVsbG8=', mediaType: 'image/jpeg' },
        ],
      }),
      executionContext: {},
    });

    const result = await adapted.tools[0].execute(
      'image-1',
      {},
      undefined,
      undefined,
      undefined,
    );
    expect(result.content).toEqual([
      { type: 'text', text: 'snapshot' },
      { type: 'image', data: 'aGVsbG8=', mimeType: 'image/jpeg' },
    ]);
  });
});
