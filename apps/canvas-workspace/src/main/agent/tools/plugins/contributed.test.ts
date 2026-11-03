import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const state = vi.hoisted(() => ({
  factories: new Map<string, (workspaceId: string) => Record<string, unknown>>(),
  external: new Set<string>(),
}));

vi.mock('../../../../plugins/main', () => ({
  getRegisteredCanvasToolFactories: () => Array.from(state.factories.entries()),
  isExternalMainPlugin: (id: string) => state.external.has(id),
}));

const { createLivePluginToolsEnginePlugin, createPluginContributedTools } = await import('./contributed');

type Hook = (input: { tools: Record<string, unknown> }) => { tools: Record<string, unknown> } | undefined;

function hookFor(scope: Parameters<typeof createLivePluginToolsEnginePlugin>[0]): Hook | undefined {
  let hook: Hook | undefined;
  createLivePluginToolsEnginePlugin(scope).initialize({
    registerHook: (_name, handler) => { hook = handler; },
  });
  return hook;
}

const todoTool = (workspaceId: string) => ({
  todo_list_read: {
    description: 'Read the todo list.',
    inputSchema: { type: 'object', properties: { status: { type: 'string' } } },
    execute: async (input: { status?: string }) => `${workspaceId || 'global'}:${input.status ?? 'all'}`,
  },
});

beforeEach(() => {
  state.factories.clear();
  state.external.clear();
});

describe('plugin-contributed tools', () => {
  it('splits built-in and market plugin tools', () => {
    state.factories.set('host-control', () => ({ host_read: { description: 'x', inputSchema: z.object({}), execute: async () => '' } }));
    state.factories.set('todo-list', todoTool);
    state.external.add('todo-list');

    expect(Object.keys(createPluginContributedTools('ws', 'built-in'))).toEqual(['host_read']);
    expect(Object.keys(createPluginContributedTools('ws', 'external'))).toEqual(['todo_list_read']);
  });

  it('adds market tools before each model call, so a plugin enabled mid-turn shows up', async () => {
    const hook = hookFor({ kind: 'global' })!;
    const builtIn = { canvas_read_node: { description: 'built-in' } };

    expect(hook({ tools: builtIn })).toBeUndefined();

    state.factories.set('todo-list', todoTool);
    state.external.add('todo-list');
    const { tools } = hook({ tools: builtIn })!;
    const tool = tools.todo_list_read as { name: string; inputSchema: unknown; execute: (input: unknown) => Promise<string> };
    expect(tool.name).toBe('todo_list_read');
    expect(tool.inputSchema).not.toBeInstanceOf(z.ZodType);
    expect(await tool.execute({ status: 'open' })).toBe('global:open');
    expect(tools.canvas_read_node).toBe(builtIn.canvas_read_node);

    // Uninstalled or reloaded plugins drop out at the next call.
    state.factories.clear();
    expect(hook({ tools: builtIn })).toBeUndefined();
  });

  it('passes the workspace id in workspace chat and keeps built-in tools on a clash', async () => {
    state.factories.set('todo-list', (workspaceId) => ({
      ...todoTool(workspaceId),
      canvas_read_node: { description: 'shadow', inputSchema: {}, execute: async () => '' },
    }));
    state.external.add('todo-list');
    const builtIn = { canvas_read_node: { description: 'built-in' } };

    const { tools } = hookFor({ kind: 'workspace', workspaceId: 'ws-1' })!({ tools: builtIn })!;
    expect(await (tools.todo_list_read as { execute: (i: unknown) => Promise<string> }).execute({})).toBe('ws-1:all');
    expect(tools.canvas_read_node).toBe(builtIn.canvas_read_node);
  });

  it('gives scheduled runs no market plugin tools', () => {
    expect(hookFor({ kind: 'scheduled', taskId: 't1' })).toBeUndefined();
  });
});
