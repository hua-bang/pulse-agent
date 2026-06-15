import { describe, expect, it, vi } from 'vitest';
import type { CanvasNode, PluginNodeData } from '../../../shared/canvas';
import type { MainCtx, PluginNodeCapabilities } from '../../types';
import {
  MOCK_CARD_NODE_TYPE,
  MOCK_NODE_PLUGIN_ID,
  MOCK_TODO_LIST_NODE_TYPE,
} from '../constants';
import { MockNodeMainPlugin } from '../main';

function createCtx() {
  const registrations: Array<{ nodeType: string; capabilities: PluginNodeCapabilities }> = [];
  const ctx: MainCtx = {
    store: {
      get: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
      list: vi.fn(),
    },
    handle: vi.fn(),
    onAgent: vi.fn(() => vi.fn()),
    getAgentService: vi.fn(() => ({} as ReturnType<MainCtx['getAgentService']>)),
    registerCanvasTool: vi.fn(),
    registerNodeCapabilities(nodeType, capabilities) {
      registrations.push({ nodeType, capabilities });
    },
  };
  return { ctx, registrations };
}

function createNode(payload: Record<string, unknown>): CanvasNode {
  return {
    id: 'node-mock',
    type: 'plugin',
    title: 'Plugin Node',
    x: 0,
    y: 0,
    width: 360,
    height: 240,
    data: {
      pluginId: MOCK_NODE_PLUGIN_ID,
      nodeType: MOCK_CARD_NODE_TYPE,
      payload,
    },
  };
}

describe('MockNodeMainPlugin', () => {
  it('registers mock.card read/write/action capabilities', async () => {
    const { ctx, registrations } = createCtx();
    await MockNodeMainPlugin.activate(ctx);

    expect(registrations.map((registration) => registration.nodeType).sort()).toEqual([
      MOCK_CARD_NODE_TYPE,
      MOCK_TODO_LIST_NODE_TYPE,
    ]);

    const capabilities = registrations.find(
      (registration) => registration.nodeType === MOCK_CARD_NODE_TYPE,
    )!.capabilities;
    const ref = {
      workspaceId: 'ws-test',
      node: createNode({ text: 'Alpha', count: 2 }),
    };

    const read = await capabilities.read?.(ref);
    expect(read).toMatchObject({
      payload: { text: 'Alpha', count: 2 },
      summary: 'Alpha (count 2)',
    });

    const write = await capabilities.write?.(ref, {
      title: 'Renamed',
      payload: { text: 'Beta', count: 5, ignored: true },
    });
    expect(write).toMatchObject({
      title: 'Renamed',
      payload: { text: 'Beta', count: 5 },
    });
    expect((write as { payload?: Record<string, unknown> }).payload).not.toHaveProperty('ignored');

    const action = await capabilities.actions?.increment(ref, { amount: 4 });
    expect(action).toMatchObject({
      patch: { payload: { count: 6 } },
      result: { count: 6, amount: 4 },
    });
  });

  it('registers todo-list read/write/action capabilities', async () => {
    const { ctx, registrations } = createCtx();
    await MockNodeMainPlugin.activate(ctx);

    const capabilities = registrations.find(
      (registration) => registration.nodeType === MOCK_TODO_LIST_NODE_TYPE,
    )!.capabilities;
    const ref = {
      workspaceId: 'ws-test',
      node: createNode({
        title: 'Launch list',
        items: [
          { id: 'todo-1', text: 'Draft', done: true },
          { id: 'todo-2', text: 'Ship', done: false },
        ],
      }),
    };
    (ref.node.data as PluginNodeData).nodeType = MOCK_TODO_LIST_NODE_TYPE;

    const read = await capabilities.read?.(ref);
    expect(read).toMatchObject({
      payload: {
        title: 'Launch list',
        items: [
          { id: 'todo-1', text: 'Draft', done: true },
          { id: 'todo-2', text: 'Ship', done: false },
        ],
      },
      summary: 'Launch list: 1 open / 1 done',
    });

    const write = await capabilities.write?.(ref, {
      payload: {
        title: 'Updated',
        items: [{ text: 'Keep this', done: false }, { text: '', done: true }],
      },
    });
    expect(write).toMatchObject({
      payload: {
        title: 'Updated',
        items: [{ id: 'todo-1', text: 'Keep this', done: false }],
      },
    });

    const add = await capabilities.actions?.add_item(ref, { text: 'Review', done: false });
    expect(add).toMatchObject({
      patch: {
        payload: {
          items: [
            { id: 'todo-1', text: 'Draft', done: true },
            { id: 'todo-2', text: 'Ship', done: false },
            { id: 'todo-3', text: 'Review', done: false },
          ],
        },
      },
      result: { ok: true, total: 3 },
    });

    const toggle = await capabilities.actions?.toggle_item(ref, { id: 'todo-2' });
    expect(toggle).toMatchObject({
      patch: {
        payload: {
          items: [
            { id: 'todo-1', text: 'Draft', done: true },
            { id: 'todo-2', text: 'Ship', done: true },
          ],
        },
      },
      result: { ok: true, id: 'todo-2' },
    });
  });
});
