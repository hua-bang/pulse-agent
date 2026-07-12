import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Pin `os.homedir()` to a temp dir BEFORE the modules under test load it so the
// default-rooted helpers (canvas-storage, workspace-node-store, tag-store,
// workspaces) read/write under a per-test sandbox rather than the developer's
// real ~/.pulse-coder/canvas tree. Mirrors tools-graph.test.ts.
const { sandboxHome } = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    sandboxHome: `${base}${trailing}knowledge-tools-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
});

const vision = vi.hoisted(() => ({
  analyze: vi.fn(async () => ({ text: 'Architecture OCR result', provider: 'openai', model: 'test-vision' })),
}));

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => sandboxHome };
});

vi.mock('../tools/_shared/vision-clients', () => ({
  resolveImageInputs: vi.fn(async (_canvas: unknown, input: { imagePaths?: string[] }) => (
    (input.imagePaths ?? []).map((path) => ({ path, mimeType: 'image/png', base64: 'stub', source: 'path' }))
  )),
  analyzeImagesWithOpenAI: vision.analyze,
  analyzeImagesWithGemini: vision.analyze,
}));

import { createKnowledgeTools } from '../tools/knowledge';
import { writeCanvasFull, type CanvasSaveData } from '../../canvas/storage';
import { writeWorkspaceNode, WORKSPACE_NODE_SCHEMA_VERSION } from '../../canvas/nodes/store';
import { upsertKnowledgeTag } from '../../canvas/nodes/tags';

const CANVAS_DIR = join(sandboxHome, '.pulse-coder', 'canvas');

function canvas(nodes: CanvasSaveData['nodes']): CanvasSaveData {
  return { nodes, edges: [], transform: { x: 0, y: 0, scale: 1 }, savedAt: new Date().toISOString() };
}

async function writeManifest(payload: unknown): Promise<void> {
  await fs.writeFile(join(CANVAS_DIR, '__workspaces__.json'), JSON.stringify(payload), 'utf-8');
}

async function seed(): Promise<void> {
  await writeManifest({
    activeId: 'ws-research',
    workspaces: [
      { id: 'ws-research', name: '调研' },
      { id: 'ws-weekly', name: '周报' },
    ],
  });

  await writeCanvasFull('ws-research', canvas([
    { id: 'n1', type: 'file', title: 'AI Agent notes', x: 0, y: 0, width: 200, height: 100, data: { content: 'Notes on building AI agents' } },
    { id: 'n2', type: 'text', title: 'Grocery list', x: 220, y: 0, width: 200, height: 100, data: { content: 'milk, eggs' } },
    { id: 'n3', type: 'iframe', title: 'RAG paper', x: 440, y: 0, width: 200, height: 100, data: { url: 'https://example.com/rag' } },
  ]));
  await writeCanvasFull('ws-weekly', canvas([
    { id: 'w1', type: 'text', title: 'Week 04.07 report', x: 0, y: 0, width: 200, height: 100, data: { content: 'shipped things' } },
    { id: 'w2', type: 'file', title: 'LLM intent', x: 220, y: 0, width: 200, height: 100, data: { content: 'intent model spec' } },
  ]));

  // Tags: id 'ai-agent' (stored on nodes by NAME) and 'rag' (stored by ID).
  await upsertKnowledgeTag({ name: 'AI Agent' });
  await upsertKnowledgeTag({ name: 'RAG' });

  await writeWorkspaceNode('ws-research', {
    schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
    id: 'n1', type: 'note', data: {},
    properties: { tags: ['AI Agent'], summary: 'Deep dive on AI agents' },
  });
  await writeWorkspaceNode('ws-research', {
    schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
    id: 'n2', type: 'note', data: {}, properties: { summary: 'shopping' }, // a knowledge record with NO tags
  });
  await writeWorkspaceNode('ws-research', {
    schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
    id: 'n3', type: 'note', data: {}, properties: { tags: ['rag'] },
  });
  await writeWorkspaceNode('ws-weekly', {
    schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
    id: 'w2', type: 'note', data: {}, properties: { tags: ['AI Agent'] },
  });
}

beforeEach(async () => {
  await fs.mkdir(CANVAS_DIR, { recursive: true });
});

afterEach(async () => {
  await fs.rm(join(sandboxHome, '.pulse-coder'), { recursive: true, force: true });
});

describe('canvas_list_workspaces', () => {
  it('lists every workspace with node + tag-coverage counts', async () => {
    await seed();
    const tools = createKnowledgeTools();

    const out = JSON.parse(await tools.canvas_list_workspaces.execute({}));
    expect(out.ok).toBe(true);
    expect(out.activeWorkspaceId).toBe('ws-research');
    const byId = new Map(out.workspaces.map((w: { workspaceId: string }) => [w.workspaceId, w]));

    expect(byId.get('ws-research')).toMatchObject({
      name: '调研', canvasNodeCount: 3, taggedNodeCount: 2, untaggedNodeCount: 1,
    });
    expect(byId.get('ws-weekly')).toMatchObject({
      name: '周报', canvasNodeCount: 2, taggedNodeCount: 1, untaggedNodeCount: 1,
    });
  });

  it('skips the tag scan when includeTagStats is false', async () => {
    await seed();
    const tools = createKnowledgeTools();
    const out = JSON.parse(await tools.canvas_list_workspaces.execute({ includeTagStats: false }));
    const ws = out.workspaces.find((w: { workspaceId: string }) => w.workspaceId === 'ws-research');
    expect(ws.canvasNodeCount).toBe(3);
    expect(ws.taggedNodeCount).toBeUndefined();
  });
});

describe('canvas_list_tags', () => {
  it('returns all tags with cross-workspace usage counts, resolving name/id storage', async () => {
    await seed();
    const tools = createKnowledgeTools();

    const out = JSON.parse(await tools.canvas_list_tags.execute({}));
    expect(out.ok).toBe(true);
    expect(out.totalKnowledgeNodes).toBe(5); // n1, n2, n3, w1, w2
    expect(out.untaggedKnowledgeNodes).toBe(2); // n2, w1
    const byId = new Map(out.tags.map((t: { id: string }) => [t.id, t]));
    expect(byId.get('ai-agent')).toMatchObject({ name: 'AI Agent', nodeCount: 2 }); // n1 (name) + w2 (name)
    expect(byId.get('rag')).toMatchObject({ name: 'RAG', nodeCount: 1 }); // n3 (id)
  });

  it('skips usage counts when includeUsage is false', async () => {
    await seed();
    const tools = createKnowledgeTools();
    const out = JSON.parse(await tools.canvas_list_tags.execute({ includeUsage: false }));
    expect(out.tags.map((t: { id: string }) => t.id).sort()).toEqual(['ai-agent', 'rag']);
    expect(out.tags[0].nodeCount).toBeUndefined();
    expect(out.totalKnowledgeNodes).toBeUndefined();
  });
});

describe('canvas_list_nodes', () => {
  it('lists nodes across all workspaces with their tags + summary', async () => {
    await seed();
    const tools = createKnowledgeTools();
    const out = JSON.parse(await tools.canvas_list_nodes.execute({}));
    expect(out.ok).toBe(true);
    expect(out.total).toBe(5); // n1, n2, n3, w1, w2
    const n1 = out.nodes.find((n: { id: string }) => n.id === 'n1');
    expect(n1).toMatchObject({ workspaceId: 'ws-research', workspaceName: '调研', tags: ['AI Agent'] });
    expect(n1.summary).toBe('Deep dive on AI agents');
  });

  it('filters to untagged nodes (records with no tags AND nodes with no record)', async () => {
    await seed();
    const tools = createKnowledgeTools();
    const out = JSON.parse(await tools.canvas_list_nodes.execute({ untaggedOnly: true }));
    expect(new Set(out.nodes.map((n: { id: string }) => n.id))).toEqual(new Set(['n2', 'w1']));
  });

  it('filters by tag, matching either the tag name or its id', async () => {
    await seed();
    const tools = createKnowledgeTools();

    const byName = JSON.parse(await tools.canvas_list_nodes.execute({ tag: 'AI Agent' }));
    expect(new Set(byName.nodes.map((n: { id: string }) => n.id))).toEqual(new Set(['n1', 'w2']));

    const byId = JSON.parse(await tools.canvas_list_nodes.execute({ tag: 'ai-agent' }));
    expect(new Set(byId.nodes.map((n: { id: string }) => n.id))).toEqual(new Set(['n1', 'w2']));

    const rag = JSON.parse(await tools.canvas_list_nodes.execute({ tag: 'rag' }));
    expect(rag.nodes.map((n: { id: string }) => n.id)).toEqual(['n3']);
  });

  it('filters by workspace and by query, and reports truncation', async () => {
    await seed();
    const tools = createKnowledgeTools();

    const scoped = JSON.parse(await tools.canvas_list_nodes.execute({ workspaceId: 'ws-weekly' }));
    expect(new Set(scoped.nodes.map((n: { id: string }) => n.id))).toEqual(new Set(['w1', 'w2']));

    const queried = JSON.parse(await tools.canvas_list_nodes.execute({ query: 'week' }));
    expect(queried.nodes.map((n: { id: string }) => n.id)).toEqual(['w1']);

    const capped = JSON.parse(await tools.canvas_list_nodes.execute({ limit: 2 }));
    expect(capped.returned).toBe(2);
    expect(capped.total).toBe(5);
    expect(capped.truncated).toBe(true);
  });
});

describe('knowledge_search_nodes / knowledge_read_node', () => {
  it('finds and reads a knowledge record that is no longer present on a canvas', async () => {
    await seed();
    await writeWorkspaceNode('ws-research', {
      schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
      id: 'img-orphan',
      type: 'image',
      title: 'Architecture screenshot',
      data: { filePath: '/tmp/architecture.png' },
      properties: { tags: ['RAG'], summary: 'A screenshot of the retrieval architecture.' },
    });
    const tools = createKnowledgeTools();

    const searched = JSON.parse(await tools.knowledge_search_nodes.execute({ query: 'architecture' }));
    expect(searched.nodes).toEqual([
      expect.objectContaining({
        id: 'img-orphan',
        type: 'image',
        title: 'Architecture screenshot',
        onCanvas: false,
      }),
    ]);

    const read = JSON.parse(await tools.knowledge_read_node.execute({ nodeId: 'img-orphan' }));
    expect(read).toMatchObject({
      ok: true,
      node: {
        id: 'img-orphan',
        type: 'image',
        onCanvas: false,
        mediaPath: '/tmp/architecture.png',
        data: { filePath: '/tmp/architecture.png' },
        properties: { summary: 'A screenshot of the retrieval architecture.' },
      },
    });
  });

  it('analyzes an off-canvas image through its knowledge-record media path', async () => {
    await seed();
    await writeWorkspaceNode('ws-research', {
      schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
      id: 'img-orphan',
      type: 'image',
      title: 'Architecture screenshot',
      data: { filePath: '/tmp/architecture.png' },
    });
    const tools = createKnowledgeTools();

    const result = JSON.parse(await tools.knowledge_analyze_image.execute({
      nodeId: 'img-orphan',
      prompt: 'Explain this architecture.',
    }));

    expect(result).toMatchObject({ ok: true, nodeId: 'img-orphan', text: 'Architecture OCR result' });
    expect(vision.analyze).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Explain this architecture.',
      images: [expect.objectContaining({ path: '/tmp/architecture.png' })],
    }));
  });
});
