import { describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../shared/canvas';
import type { MainCtx, PluginNodeCapabilities } from '../../types';
import { MOCK_CARD_NODE_TYPE, MOCK_NODE_PLUGIN_ID } from '../constants';
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

    expect(registrations).toHaveLength(1);
    expect(registrations[0].nodeType).toBe(MOCK_CARD_NODE_TYPE);

    const capabilities = registrations[0].capabilities;
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
});
