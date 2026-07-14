import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => Promise<unknown>>(),
  node: {
    schemaVersion: 1,
    id: 'node-1',
    type: 'text',
    title: 'Before',
    data: { content: 'Before' },
    properties: { owner: 'Jasper' },
    updatedAt: 1,
  } as Record<string, any>,
  mutationTail: Promise.resolve(),
  listedNodes: [] as Record<string, any>[],
  canvasData: null as Record<string, any> | null,
}));

const cloneNode = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => Promise<unknown>) => {
      testState.handlers.set(channel, handler);
    },
  },
}));

vi.mock('../canvas/nodes/store', () => ({
  listWorkspaceNodes: async () => cloneNode(testState.listedNodes),
  readWorkspaceNode: async () => cloneNode(testState.node),
  writeWorkspaceNode: async (_workspaceId: string, node: Record<string, any>) => {
    // Yield so two legacy read-then-write handlers can both capture the same
    // stale snapshot before either write lands.
    await Promise.resolve();
    testState.node = cloneNode(node);
  },
  mutateWorkspaceNode: async (
    _workspaceId: string,
    _nodeId: string,
    mutation: (current: Record<string, any>) => Promise<{
      record?: Record<string, any>;
      result: unknown;
    }> | { record?: Record<string, any>; result: unknown },
  ) => {
    const previous = testState.mutationTail;
    let release!: () => void;
    testState.mutationTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const prepared = await mutation(cloneNode(testState.node));
      if (prepared.record) testState.node = cloneNode(prepared.record);
      return prepared.result;
    } finally {
      release();
    }
  },
}));

vi.mock('../canvas/nodes/tags', () => ({
  readKnowledgeTags: async () => [],
  upsertKnowledgeTag: async (tag: { name: string }) => ({ id: tag.name, name: tag.name }),
}));

vi.mock('../canvas/nodes/broadcast', () => ({
  broadcastWorkspaceNodesChanged: vi.fn(),
  scheduleWorkspaceNodesChanged: vi.fn(),
}));

vi.mock('../canvas/storage', () => ({
  readCanvasFull: async () => ({ data: cloneNode(testState.canvasData) }),
}));

import { setupWorkspaceNodeIpc } from '../canvas/nodes/ipc';

beforeEach(() => {
  testState.handlers.clear();
  testState.node = {
    schemaVersion: 1,
    id: 'node-1',
    type: 'text',
    title: 'Before',
    data: { content: 'Before' },
    properties: { owner: 'Jasper' },
    updatedAt: 1,
  };
  testState.mutationTail = Promise.resolve();
  testState.listedNodes = [];
  testState.canvasData = null;
  setupWorkspaceNodeIpc();
});

describe('workspace-node IPC mutations', () => {
  it('prefers an explicit title but falls back from a type placeholder to text content', async () => {
    testState.listedNodes = [{
      schemaVersion: 1,
      id: 'text-1',
      type: 'text',
      title: 'Text',
      data: {},
      updatedAt: 1,
    }];
    testState.canvasData = {
      nodes: [{
        id: 'text-1',
        type: 'text',
        title: 'Text',
        data: { content: '<p>正文第一行</p>' },
      }],
    };
    const list = testState.handlers.get('workspace-node:list');
    if (!list) throw new Error('workspace-node:list handler was not registered');

    const placeholder = await list(undefined, { workspaceId: 'workspace-1' }) as {
      nodes: Array<{ displayTitle?: string }>;
    };
    expect(placeholder.nodes[0]?.displayTitle).toBe('正文第一行');

    testState.listedNodes[0].title = '明确标题';
    const explicit = await list(undefined, { workspaceId: 'workspace-1' }) as {
      nodes: Array<{ displayTitle?: string }>;
    };
    expect(explicit.nodes[0]?.displayTitle).toBe('明确标题');
  });

  it('exposes the local image path needed for a lazy masonry thumbnail', async () => {
    testState.listedNodes = [{
      schemaVersion: 1,
      id: 'image-1',
      type: 'image',
      title: 'Reference',
      data: {},
      updatedAt: 1,
    }];
    testState.canvasData = {
      nodes: [{
        id: 'image-1',
        type: 'image',
        title: 'Reference',
        data: { filePath: '/tmp/reference.png' },
      }],
    };
    const list = testState.handlers.get('workspace-node:list');
    if (!list) throw new Error('workspace-node:list handler was not registered');

    const result = await list(undefined, { workspaceId: 'workspace-1' }) as {
      ok: boolean;
      nodes: Array<{ previewPath?: string }>;
    };

    expect(result.ok).toBe(true);
    expect(result.nodes[0]?.previewPath).toBe('/tmp/reference.png');
  });

  it('serializes ordinary updates so concurrent field edits are both preserved', async () => {
    const update = testState.handlers.get('workspace-node:update');
    if (!update) throw new Error('workspace-node:update handler was not registered');

    await Promise.all([
      update(undefined, {
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        patch: { title: 'New title' },
      }),
      update(undefined, {
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        patch: { data: { content: 'New content' } },
      }),
    ]);

    expect(testState.node).toMatchObject({
      title: 'New title',
      data: { content: 'New content' },
      properties: { owner: 'Jasper' },
    });
  });

  it('serializes tag updates with ordinary edits without dropping either patch', async () => {
    const update = testState.handlers.get('workspace-node:update');
    const updateTags = testState.handlers.get('workspace-node:update-tags');
    if (!update || !updateTags) throw new Error('workspace-node mutation handlers were not registered');

    await Promise.all([
      update(undefined, {
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        patch: { title: 'New title' },
      }),
      updateTags(undefined, {
        workspaceId: 'workspace-1',
        nodeId: 'node-1',
        tags: ['AI'],
      }),
    ]);

    expect(testState.node).toMatchObject({
      title: 'New title',
      properties: { owner: 'Jasper', tags: ['AI'] },
    });
  });
});
