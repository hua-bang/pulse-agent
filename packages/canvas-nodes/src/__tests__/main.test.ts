import { describe, expect, it, vi } from 'vitest';
import mainPlugin from '../main';
import { CANVAS_NODES_PLUGIN_ID, EXCALIDRAW_BOARD_NODE_TYPE } from '../constants';
import type { CanvasNode, MainCtx, PluginNodeCapabilities } from '../types';

function createCtx() {
  const registrations: Array<{ nodeType: string; capabilities: PluginNodeCapabilities }> = [];
  const toolFactories: Array<(workspaceId: string) => Record<string, unknown>> = [];
  const ctx: MainCtx = {
    registerNodeCapabilities(nodeType, capabilities) {
      registrations.push({ nodeType, capabilities });
    },
    registerCanvasTool(factory) {
      toolFactories.push(factory);
    },
  };
  return { ctx, registrations, toolFactories };
}

function createNode(payload: Record<string, unknown> = {}): CanvasNode {
  return {
    id: 'node-1',
    type: 'plugin',
    title: 'Board',
    x: 0,
    y: 0,
    width: 640,
    height: 420,
    data: {
      pluginId: CANVAS_NODES_PLUGIN_ID,
      nodeType: EXCALIDRAW_BOARD_NODE_TYPE,
      payload,
    },
  };
}

describe('excalidraw main plugin', () => {
  it('registers board capabilities and reads a scene summary', async () => {
    const { ctx, registrations } = createCtx();
    await mainPlugin.activate(ctx);

    expect(registrations).toHaveLength(1);
    expect(registrations[0].nodeType).toBe(EXCALIDRAW_BOARD_NODE_TYPE);

    const read = await registrations[0].capabilities.read?.({
      workspaceId: 'ws',
      node: createNode({
        title: 'Sketch',
        elements: [{ id: 't1', type: 'text', text: 'Hello' }],
      }),
    });

    expect(read).toMatchObject({
      summary: {
        title: 'Sketch',
        elementCount: 1,
        texts: ['Hello'],
      },
    });
  });

  it('sets, appends, and clears scenes through actions', async () => {
    const { ctx, registrations } = createCtx();
    await mainPlugin.activate(ctx);
    const capabilities = registrations[0].capabilities;
    const node = createNode();
    const ref = { workspaceId: 'ws', node };

    const set = await capabilities.actions?.set_scene(ref, {
      title: 'Flow',
      skeleton: [{ type: 'rectangle', text: 'Input' }],
    });
    expect(set).toMatchObject({
      result: {
        ok: true,
        mode: 'replace',
      },
    });
    expect((set as any).patch.payload.elements.length).toBe(2);

    node.data = {
      ...(node.data as Record<string, unknown>),
      payload: (set as any).patch.payload,
    };
    const append = await capabilities.actions?.append_elements(ref, {
      skeleton: [{ type: 'text', text: 'Output' }],
    });
    expect((append as any).result.appended).toBe(1);
    expect((append as any).patch.payload.elements.length).toBe(3);

    node.data = {
      ...(node.data as Record<string, unknown>),
      payload: (append as any).patch.payload,
    };
    const cleared = await capabilities.actions?.clear_scene(ref, {});
    expect((cleared as any).patch.payload.elements).toEqual([]);
  });

  it('registers a skeleton template helper tool', async () => {
    const { ctx, toolFactories } = createCtx();
    await mainPlugin.activate(ctx);

    expect(toolFactories).toHaveLength(1);
    const tools = toolFactories[0]('ws');
    const tool = tools.excalidraw_board_template as {
      execute(input: Record<string, unknown>): Promise<string>;
    };
    const result = JSON.parse(await tool.execute({
      title: 'Runtime',
      labels: ['Tools', 'Agents', 'Data'],
    })) as Record<string, any>;

    expect(result.pluginId).toBe(CANVAS_NODES_PLUGIN_ID);
    expect(result.nodeType).toBe(EXCALIDRAW_BOARD_NODE_TYPE);
    expect(result.input.skeleton.length).toBeGreaterThan(3);
  });

  it('keeps write normalization scoped to payload patches', async () => {
    const { ctx, registrations } = createCtx();
    await mainPlugin.activate(ctx);
    const write = registrations[0].capabilities.write;
    expect(write).toBeTypeOf('function');

    const patch = await write?.({
      workspaceId: 'ws',
      node: createNode(),
    }, {
      title: 'Renamed',
      payload: {
        title: 'Scene title',
        skeleton: [{ type: 'text', text: 'A' }],
      },
    });

    expect(patch).toMatchObject({
      title: 'Renamed',
      payload: {
        title: 'Scene title',
      },
    });
    expect((patch as any).payload.elements).toHaveLength(1);
  });
});
