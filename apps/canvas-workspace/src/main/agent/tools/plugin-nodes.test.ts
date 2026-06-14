import { beforeEach, describe, expect, it, vi } from 'vitest';

const { canvasState } = vi.hoisted(() => ({
  canvasState: {
    current: null as null | {
      nodes: Array<{
        id: string;
        type: string;
        title: string;
        x: number;
        y: number;
        width: number;
        height: number;
        data: Record<string, unknown>;
        updatedAt?: number;
      }>;
      edges: unknown[];
      transform: { x: number; y: number; scale: number };
      savedAt: string;
    },
  },
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
  app: { getPath: () => '/tmp/canvas-plugin-node-tools-test' },
}));

vi.mock('./_shared/canvas-io', () => ({
  STORE_DIR: '/tmp/canvas-plugin-node-tools-test',
  loadCanvas: vi.fn(async () => canvasState.current),
  saveCanvas: vi.fn(async (_workspaceId: string, data: unknown) => {
    canvasState.current = JSON.parse(JSON.stringify(data));
  }),
}));

vi.mock('./_shared/broadcast', () => ({
  broadcastUpdate: vi.fn(),
}));

describe('plugin node tools', () => {
  beforeEach(() => {
    vi.resetModules();
    canvasState.current = {
      nodes: [
        {
          id: 'node-plugin',
          type: 'plugin',
          title: 'Plugin Node',
          x: 0,
          y: 0,
          width: 360,
          height: 240,
          data: {
            pluginId: 'mock',
            nodeType: 'mock.card',
            payload: {
              text: 'Alpha',
              count: 1,
            },
          },
        },
      ],
      edges: [],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: new Date().toISOString(),
    };
  });

  it('reads, writes, and executes mock.card capabilities', async () => {
    const { setupCanvasPlugins } = await import('../../../plugins/main/registry');
    const { MockNodeMainPlugin } = await import('../../../plugins/mock-node/main');
    const { createPluginNodeTools } = await import('./plugin-nodes');

    await setupCanvasPlugins([MockNodeMainPlugin]);
    const tools = createPluginNodeTools('ws-plugin-test');

    const read = JSON.parse(await tools.canvas_plugin_node_read.execute({
      nodeId: 'node-plugin',
    }));
    expect(read.ok).toBe(true);
    expect(read.content).toContain('Mock card: Alpha');
    expect(read.availableActions).toEqual(['increment']);

    const write = JSON.parse(await tools.canvas_plugin_node_write.execute({
      nodeId: 'node-plugin',
      payload: { text: 'Beta' },
    }));
    expect(write.ok).toBe(true);
    expect(canvasState.current?.nodes[0].data.payload).toMatchObject({
      text: 'Beta',
      count: 1,
    });

    const action = JSON.parse(await tools.canvas_plugin_node_action.execute({
      nodeId: 'node-plugin',
      action: 'increment',
      input: { amount: 2 },
    }));
    expect(action.ok).toBe(true);
    expect(action.result).toMatchObject({ count: 3, amount: 2 });
    expect(canvasState.current?.nodes[0].data.payload).toMatchObject({
      text: 'Beta',
      count: 3,
    });
  });
});
