import { describe, expect, it, vi } from 'vitest';
import { Engine } from 'pulse-coder-engine';
import { z } from 'zod';
import { executeMcpAppTool } from './mcp-app-runtime';

describe('executeMcpAppTool', () => {
  it('uses the Engine validation and hook lifecycle', async () => {
    const before = vi.fn();
    const after = vi.fn((_name: string, _input: unknown, output: unknown) => ({ wrapped: output }));
    const engine = new Engine({
      disableBuiltInPlugins: true,
      builtInTools: {},
      tools: {
        mcp_demo_write: {
          description: 'demo',
          inputSchema: z.object({ value: z.number() }),
          execute: async ({ value }: { value: number }) => ({ value }),
        },
      },
      hooks: { onBeforeToolCall: before, onAfterToolCall: after },
    });
    await engine.initialize();

    const execution = await executeMcpAppTool(
      engine,
      'mcp_demo_write',
      { value: 3 },
      new AbortController().signal,
    );
    expect(execution.result).toEqual({ wrapped: { value: 3 } });
    expect(before).toHaveBeenCalledOnce();
    expect(after).toHaveBeenCalledOnce();
    await expect(executeMcpAppTool(
      engine,
      'mcp_demo_write',
      { value: 'invalid' },
      new AbortController().signal,
    )).rejects.toThrow('Invalid input');
  });
});
