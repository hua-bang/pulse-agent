import { beforeEach, describe, expect, it, vi } from 'vitest';

const { canvasState } = vi.hoisted(() => ({
  canvasState: {
    current: null as null | {
      nodes: Array<{ id: string; type: string; width: number; height: number; data: Record<string, unknown> }>;
      edges: unknown[];
      transform: { x: number; y: number; scale: number };
      savedAt: string;
    },
  },
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
  app: { getPath: () => '/tmp/canvas-web-image-node-test' },
}));

vi.mock('../_shared/canvas-io', () => ({
  STORE_DIR: '/tmp/canvas-web-image-node-test',
  loadCanvas: vi.fn(async () => canvasState.current),
  saveCanvas: vi.fn(async (_workspaceId: string, data: unknown) => {
    canvasState.current = JSON.parse(JSON.stringify(data));
  }),
}));

vi.mock('../_shared/broadcast', () => ({ broadcastUpdate: vi.fn() }));

vi.mock('../_shared/web-image', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../_shared/web-image')>()),
  downloadWebImage: vi.fn(async (_workspaceId: string, url: string) => {
    if (url.includes('broken')) throw new Error(`image download failed with HTTP 404: ${url}`);
    return { filePath: '/tmp/canvas-web-image-node-test/ws/images/web-1.png', bytes: 10, size: { width: 1600, height: 900 } };
  }),
}));

describe('canvas_create_node with a web image', () => {
  beforeEach(() => {
    canvasState.current = { nodes: [], edges: [], transform: { x: 0, y: 0, scale: 1 }, savedAt: '' };
  });

  it('saves the image locally and sizes the node to its aspect ratio', async () => {
    const { createNodeTools } = await import('./nodes');
    const tools = createNodeTools('ws');

    await tools.canvas_create_node.execute({ type: 'image', title: 'Chart', data: { url: 'https://example.com/chart.png' } });

    const node = canvasState.current?.nodes[0];
    expect(node).toMatchObject({
      type: 'image',
      width: 480,
      height: 270,
      data: { filePath: '/tmp/canvas-web-image-node-test/ws/images/web-1.png' },
    });
  });

  it('keeps the aspect ratio when only the width is given', async () => {
    const { createNodeTools } = await import('./nodes');
    const tools = createNodeTools('ws');

    await tools.canvas_create_node.execute({ type: 'image', width: 320, data: { url: 'https://example.com/chart.png' } });

    expect(canvasState.current?.nodes[0]).toMatchObject({ width: 320, height: 180 });
  });

  it('returns the download error and creates nothing', async () => {
    const { createNodeTools } = await import('./nodes');
    const tools = createNodeTools('ws');

    const result = await tools.canvas_create_node.execute({ type: 'image', data: { url: 'https://example.com/broken.png' } });

    expect(result).toContain('HTTP 404');
    expect(canvasState.current?.nodes).toHaveLength(0);
  });
});
