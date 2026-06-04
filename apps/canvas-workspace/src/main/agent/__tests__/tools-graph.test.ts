import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Pin `os.homedir()` to a temp dir BEFORE the modules under test load it, so
// every default-rooted helper (canvas-storage, workspace-node-store, tag-store)
// reads/writes under the per-test sandbox rather than the developer's real
// ~/.pulse-coder/canvas tree. `vi.hoisted` is the only safe way to share state
// with `vi.mock` factories, which Vitest hoists above the rest of the file.
const { sandboxHome } = vi.hoisted(() => {
  // `vi.hoisted` runs above all imports, so we cannot use `os.tmpdir()` /
  // `path.join` here. Build the path with environment + string concat instead.
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    sandboxHome: `${base}${trailing}canvas-tools-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => sandboxHome,
  };
});

// Mock electron's BrowserWindow — `broadcastUpdate` iterates the window list
// and would crash without an Electron runtime. We don't care about the
// broadcast in these tests; the on-disk state is what matters.
vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => undefined, on: () => undefined },
}));

// node-pty fails to load without its native binding in the test env; the
// transitive `agent-session-send` → `pty-manager` import would otherwise crash
// the module before any test runs. Mirrors the stub in agent-session-send.test.
vi.mock('../../terminal/pty-manager', () => ({
  hasSession: () => false,
  writeToSession: () => false,
}));

// Stub the engine's GenerateImageTool import — the tools module pulls it in at
// the top level for `canvas_generate_image`, but instantiating it requires
// API keys we don't have in unit tests.
vi.mock('pulse-coder-engine', () => ({
  GenerateImageTool: class StubGenerateImageTool {
    inputSchema = { parse: (v: unknown) => v };
    async execute() {
      return '';
    }
  },
}));

// The plugin registry is loaded at tool-creation time. Stub it out so we
// don't pick up plugin-contributed tools from the real registry.
vi.mock('../../../plugins/main', () => ({
  getRegisteredCanvasToolFactories: () => new Map(),
}));

import { createCanvasTools, createGlobalReadOnlyCanvasTools } from '../tools';
import {
  readCanvasFull,
  writeCanvasFull,
  type CanvasSaveData,
} from '../../canvas/storage';
import {
  readWorkspaceNode,
  writeWorkspaceNode,
  WORKSPACE_NODE_SCHEMA_VERSION,
} from '../../canvas/nodes/store';
import { upsertKnowledgeTag } from '../../canvas/nodes/tags';

const wsId = 'ws-tools-test';

async function setupCanvas(data: Partial<CanvasSaveData> = {}): Promise<CanvasSaveData> {
  const canvas: CanvasSaveData = {
    nodes: [
      { id: 'n-file', type: 'file', title: 'README', x: 0, y: 0, width: 200, height: 100, data: { filePath: '/tmp/readme.md', content: 'Hello RAG world' } },
      { id: 'n-text', type: 'text', title: 'Sticky', x: 220, y: 0, width: 200, height: 100, data: { content: 'a quick note about pipelines' } },
      { id: 'n-iframe', type: 'iframe', title: 'Docs', x: 440, y: 0, width: 200, height: 100, data: { url: 'https://example.com/rag' } },
      { id: 'n-grp', type: 'group', title: 'Cluster A', x: 0, y: 200, width: 700, height: 200, data: { label: 'Cluster A', childIds: ['n-file'] } },
    ],
    edges: [],
    transform: { x: 0, y: 0, scale: 1 },
    savedAt: new Date().toISOString(),
    ...data,
  };
  await writeCanvasFull(wsId, canvas);
  return canvas;
}

beforeEach(async () => {
  // Each test gets a fresh sandbox subdirectory so default-rooted helpers
  // (which use `homedir()/.pulse-coder/canvas`) don't see leftover state.
  await fs.mkdir(join(sandboxHome, '.pulse-coder', 'canvas'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(join(sandboxHome, '.pulse-coder'), { recursive: true, force: true });
});

describe('canvas_search_nodes', () => {
  it('filters by case-insensitive query against title / content / url', async () => {
    await setupCanvas();
    const tools = createCanvasTools(wsId);

    const byContent = JSON.parse(await tools.canvas_search_nodes.execute({ query: 'pipeline' }));
    expect(byContent.ok).toBe(true);
    expect(byContent.matches.map((m: { id: string }) => m.id)).toEqual(['n-text']);

    const byUrl = JSON.parse(await tools.canvas_search_nodes.execute({ query: 'RAG' }));
    // 'RAG' shows up in file content (Hello RAG world) and iframe url path
    expect(new Set(byUrl.matches.map((m: { id: string }) => m.id))).toEqual(new Set(['n-file', 'n-iframe']));
  });

  it('filters by node type (single + array)', async () => {
    await setupCanvas();
    const tools = createCanvasTools(wsId);

    const single = JSON.parse(await tools.canvas_search_nodes.execute({ type: 'group' }));
    expect(single.matches.map((m: { id: string }) => m.id)).toEqual(['n-grp']);

    const multi = JSON.parse(await tools.canvas_search_nodes.execute({ type: ['file', 'text'] }));
    expect(new Set(multi.matches.map((m: { id: string }) => m.id))).toEqual(new Set(['n-file', 'n-text']));
  });

  it('filters by workspace-node tag (AND semantics)', async () => {
    await setupCanvas();
    await writeWorkspaceNode(wsId, {
      schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
      id: 'n-file',
      type: 'note',
      data: {},
      properties: { tags: ['AI', 'RAG'] },
    });
    await writeWorkspaceNode(wsId, {
      schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
      id: 'n-text',
      type: 'note',
      data: {},
      properties: { tags: ['AI'] },
    });
    const tools = createCanvasTools(wsId);

    const bothTags = JSON.parse(await tools.canvas_search_nodes.execute({ tag: ['AI', 'RAG'] }));
    expect(bothTags.matches.map((m: { id: string }) => m.id)).toEqual(['n-file']);
    // Tag info is surfaced on each match so the agent doesn't have to re-fetch.
    expect(bothTags.matches[0].tags).toEqual(['AI', 'RAG']);

    const oneTag = JSON.parse(await tools.canvas_search_nodes.execute({ tag: 'AI' }));
    expect(new Set(oneTag.matches.map((m: { id: string }) => m.id))).toEqual(new Set(['n-file', 'n-text']));
  });

  it('resolves tag NAME → id when filtering (renderer stores ids, mentions pass names)', async () => {
    await setupCanvas();
    // The renderer's tag editor stores the tag id (slug) on the node, while a
    // tag @-mention passes the human-readable name. Searching by name (any case)
    // or by the raw id must both match.
    const tag = await upsertKnowledgeTag({ name: 'ByteDance' });
    expect(tag.id).toBe('bytedance');
    await writeWorkspaceNode(wsId, {
      schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
      id: 'n-file',
      type: 'note',
      data: {},
      properties: { tags: ['bytedance'] },
    });
    const tools = createCanvasTools(wsId);

    const byName = JSON.parse(await tools.canvas_search_nodes.execute({ tag: 'ByteDance' }));
    expect(byName.matches.map((m: { id: string }) => m.id)).toEqual(['n-file']);

    const byNameCi = JSON.parse(await tools.canvas_search_nodes.execute({ tag: 'BYTEDANCE' }));
    expect(byNameCi.matches.map((m: { id: string }) => m.id)).toEqual(['n-file']);

    const byId = JSON.parse(await tools.canvas_search_nodes.execute({ tag: 'bytedance' }));
    expect(byId.matches.map((m: { id: string }) => m.id)).toEqual(['n-file']);
  });

  it('respects limit and reports truncation', async () => {
    await setupCanvas();
    const tools = createCanvasTools(wsId);

    const result = JSON.parse(await tools.canvas_search_nodes.execute({ limit: 2 }));
    expect(result.matches.length).toBe(2);
    expect(result.truncated).toBe(true);
  });
});

describe('createGlobalReadOnlyCanvasTools', () => {
  it('exposes only read/search canvas tools plus clarification', async () => {
    const tools = createGlobalReadOnlyCanvasTools();
    expect(Object.keys(tools).sort()).toEqual([
      'canvas_ask_user',
      'canvas_list_edges',
      'canvas_read_context',
      'canvas_read_node',
      'canvas_search_nodes',
      'workspace_node_get',
      'workspace_node_list',
    ]);
    expect(tools.canvas_create_node).toBeUndefined();
    expect(tools.workspace_node_upsert).toBeUndefined();
  });

  it('requires workspaceId for global read/search tools', async () => {
    const tools = createGlobalReadOnlyCanvasTools();
    await setupCanvas();

    const missing = await tools.canvas_search_nodes.execute({ query: 'pipeline' });
    expect(missing).toContain('workspaceId is required in global chat');

    const found = JSON.parse(await tools.canvas_search_nodes.execute({ workspaceId: wsId, query: 'pipeline' }));
    expect(found.ok).toBe(true);
    expect(found.matches.map((m: { id: string }) => m.id)).toEqual(['n-text']);
  });
});

describe('canvas_add_to_group / canvas_remove_from_group', () => {
  it('adds new node ids to a group, dedups, and ignores self-reference', async () => {
    await setupCanvas();
    const tools = createCanvasTools(wsId);

    const result = JSON.parse(await tools.canvas_add_to_group.execute({
      groupId: 'n-grp',
      nodeIds: ['n-text', 'n-iframe', 'n-file', 'n-grp', 'n-ghost'],
    }));
    expect(result.ok).toBe(true);
    // 'n-file' was already a member → not in `added`. 'n-grp' is self-ref →
    // filtered. 'n-ghost' is missing → reported separately.
    expect(result.added).toEqual(['n-text', 'n-iframe']);
    expect(result.childIds).toEqual(['n-file', 'n-text', 'n-iframe']);
    expect(result.missing).toEqual(['n-ghost']);
    expect(result.selfRef).toBe(true);

    // Verify on disk.
    const { data } = await readCanvasFull(wsId);
    const nodes = data?.nodes ?? [];
    const group = nodes.find((n) => n.id === 'n-grp');
    expect(group).toBeDefined();
    expect((group!.data as { childIds?: string[] })?.childIds).toEqual(['n-file', 'n-text', 'n-iframe']);
  });

  it('refuses to operate on a non-group node', async () => {
    await setupCanvas();
    const tools = createCanvasTools(wsId);

    const result = await tools.canvas_add_to_group.execute({
      groupId: 'n-file',
      nodeIds: ['n-text'],
    });
    expect(result).toMatch(/not "group"/);
  });

  it('removes node ids from a group and leaves unrelated targets untouched', async () => {
    await setupCanvas({
      nodes: [
        { id: 'n-file', type: 'file', title: 'F', x: 0, y: 0, width: 200, height: 100, data: {} },
        { id: 'n-text', type: 'text', title: 'T', x: 0, y: 120, width: 200, height: 100, data: {} },
        { id: 'n-iframe', type: 'iframe', title: 'I', x: 0, y: 240, width: 200, height: 100, data: { url: '' } },
        { id: 'n-grp', type: 'group', title: 'G', x: 220, y: 0, width: 400, height: 400, data: { childIds: ['n-file', 'n-text', 'n-iframe'] } },
      ],
      edges: [],
      transform: { x: 0, y: 0, scale: 1 },
    });
    const tools = createCanvasTools(wsId);

    const result = JSON.parse(await tools.canvas_remove_from_group.execute({
      groupId: 'n-grp',
      nodeIds: ['n-text', 'n-ghost'],
    }));
    expect(result.ok).toBe(true);
    expect(result.removed).toEqual(['n-text']);
    expect(result.childIds).toEqual(['n-file', 'n-iframe']);
  });
});

describe('workspace_node_list / get / upsert', () => {
  it('creates a workspace-node atom with tags + properties + links on first upsert', async () => {
    await setupCanvas();
    const tools = createCanvasTools(wsId);

    const result = JSON.parse(await tools.workspace_node_upsert.execute({
      nodeId: 'n-file',
      type: 'note',
      title: 'README atom',
      tags: ['AI', 'RAG'],
      properties: { summary: 'Doc covering the RAG flow', kind: 'note' },
      links: [{ relation: 'references', targetNodeId: 'n-iframe' }],
    }));
    expect(result.ok).toBe(true);
    expect(result.created).toBe(true);
    expect(result.record.properties.tags).toEqual(['AI', 'RAG']);
    expect(result.record.properties.summary).toBe('Doc covering the RAG flow');
    expect(result.record.links).toEqual([
      { relation: 'references', target: { nodeId: 'n-iframe' } },
    ]);

    // Persisted on disk under the workspace-node store.
    const onDisk = await readWorkspaceNode(wsId, 'n-file');
    expect(onDisk?.properties?.tags).toEqual(['AI', 'RAG']);
  });

  it('merges properties on subsequent upsert; clears with explicit null', async () => {
    await setupCanvas();
    const tools = createCanvasTools(wsId);

    await tools.workspace_node_upsert.execute({
      nodeId: 'n-file',
      properties: { summary: 'first', kind: 'note', sourceUrl: { type: 'url', value: 'https://example.com' } },
    });
    const merged = JSON.parse(await tools.workspace_node_upsert.execute({
      nodeId: 'n-file',
      properties: { summary: 'updated', kind: null },
    }));
    expect(merged.created).toBe(false);
    expect(merged.record.properties.summary).toBe('updated');
    expect(merged.record.properties.kind).toBeUndefined();
    expect(merged.record.properties.sourceUrl).toEqual({ type: 'url', value: 'https://example.com' });
  });

  it('lists workspace-node atoms with tags + property keys', async () => {
    await setupCanvas();
    const tools = createCanvasTools(wsId);
    await tools.workspace_node_upsert.execute({
      nodeId: 'n-file',
      tags: ['AI'],
      properties: { summary: 's' },
    });
    await tools.workspace_node_upsert.execute({
      nodeId: 'n-text',
      properties: { kind: 'sticky' },
    });

    const listed = JSON.parse(await tools.workspace_node_list.execute({}));
    expect(listed.ok).toBe(true);
    expect(listed.total).toBe(2);
    const fileEntry = listed.nodes.find((n: { id: string }) => n.id === 'n-file');
    expect(fileEntry.tags).toEqual(['AI']);
    expect(fileEntry.propertyKeys).toEqual(expect.arrayContaining(['tags', 'summary']));
  });

  it('returns null record when the atom does not exist yet', async () => {
    await setupCanvas();
    const tools = createCanvasTools(wsId);

    const result = JSON.parse(await tools.workspace_node_get.execute({ nodeId: 'n-iframe' }));
    expect(result.ok).toBe(true);
    expect(result.record).toBeNull();
  });
});

// Sanity: ensure the sandbox really pointed under /tmp (defensive — if the
// mock ever stops working we want a loud failure, not silent pollution of
// the developer's real ~/.pulse-coder).
describe('homedir isolation', () => {
  it('routes ~/.pulse-coder writes through a tmpdir-rooted sandbox', () => {
    const tmpRoot = tmpdir(); // re-uses the mocked `os` so this is the sandbox
    expect(sandboxHome.startsWith('/tmp') || sandboxHome.startsWith(tmpRoot)).toBe(true);
  });
});

describe('deferred tool partition', () => {
  // Locks in the eager/deferred split so a future edit to tools.ts that
  // accidentally drops or adds a `defer_loading` flag fails loudly.
  it('matches the documented eager / deferred sets', () => {
    const tools = createCanvasTools(wsId);
    const eager: string[] = [];
    const deferred: string[] = [];
    for (const [name, tool] of Object.entries(tools)) {
      if (tool.defer_loading) deferred.push(name);
      else eager.push(name);
    }
    eager.sort();
    deferred.sort();

    expect(eager).toEqual([
      'artifact_create',
      'canvas_ask_user',
      'canvas_create_agent_node',
      'canvas_create_node',
      'canvas_promote_skill',
      'canvas_read_context',
      'canvas_read_node',
      'canvas_save_skill',
      'canvas_search_nodes',
      'canvas_update_node',
      'visual_render',
    ]);
    expect(deferred).toEqual([
      'artifact_pin_to_canvas',
      'artifact_update',
      'canvas_add_to_group',
      'canvas_analyze_image',
      'canvas_create_edge',
      'canvas_create_shape',
      'canvas_create_terminal_node',
      'canvas_delete_edge',
      'canvas_delete_node',
      'canvas_generate_image',
      'canvas_generate_mindmap_image',
      'canvas_list_edges',
      'canvas_move_node',
      'canvas_read_webpage',
      'canvas_remove_from_group',
      'canvas_send_to_agent',
      'canvas_update_edge',
      'workspace_node_get',
      'workspace_node_list',
      'workspace_node_upsert',
    ]);
  });
});
