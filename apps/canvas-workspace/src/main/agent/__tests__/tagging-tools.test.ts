import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';

// Pin os.homedir() to a sandbox before the default-rooted helpers load it.
// `sentEvents` captures the renderer broadcasts the tool fires (canvas_tag_node
// -> broadcastWorkspaceNodesChanged -> webContents.send).
const { sandboxHome, sentEvents } = vi.hoisted(() => {
  const base = process.env.TMPDIR || process.env.TEMP || '/tmp';
  const trailing = base.endsWith('/') ? '' : '/';
  return {
    sandboxHome: `${base}${trailing}tagging-tools-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sentEvents: [] as Array<{ channel: string; payload: { workspaceIds?: string[] } }>,
  };
});

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return { ...actual, homedir: () => sandboxHome };
});

// The broadcaster imports electron's BrowserWindow; stub it to capture sends.
vi.mock('electron', () => ({
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: {
          send: (channel: string, payload: unknown) => {
            sentEvents.push({ channel, payload: payload as { workspaceIds?: string[] } });
          },
        },
      },
    ],
  },
}));

import { createTaggingTools, __testing } from '../tools/tagging';
import { writeCanvasFull, type CanvasSaveData } from '../../canvas/storage';
import { readWorkspaceNode, writeWorkspaceNode, WORKSPACE_NODE_SCHEMA_VERSION } from '../../canvas/nodes/store';
import { readKnowledgeTags, upsertKnowledgeTag } from '../../canvas/nodes/tags';

const CANVAS_DIR = join(sandboxHome, '.pulse-coder', 'canvas');

function canvas(nodes: CanvasSaveData['nodes']): CanvasSaveData {
  return { nodes, edges: [], transform: { x: 0, y: 0, scale: 1 }, savedAt: new Date().toISOString() };
}

async function tagsOf(workspaceId: string, nodeId: string): Promise<string[]> {
  const record = await readWorkspaceNode(workspaceId, nodeId);
  const raw = record?.properties?.tags;
  return Array.isArray(raw) ? (raw as string[]) : [];
}

async function seed(): Promise<void> {
  await writeCanvasFull('ws-a', canvas([
    { id: 'a1', type: 'file', title: 'AI notes', x: 0, y: 0, width: 200, height: 100, data: { content: 'about agents' } },
    { id: 'a2', type: 'text', title: 'todo', x: 220, y: 0, width: 200, height: 100, data: { content: 'later' } },
  ]));
  await writeCanvasFull('ws-b', canvas([
    { id: 'b1', type: 'file', title: 'LLM', x: 0, y: 0, width: 200, height: 100, data: { content: 'spec' } },
  ]));
  await upsertKnowledgeTag({ name: 'RAG' }); // id 'rag'
  // a1 already carries the RAG tag (stored by id, like the renderer does).
  await writeWorkspaceNode('ws-a', {
    schemaVersion: WORKSPACE_NODE_SCHEMA_VERSION,
    id: 'a1', type: 'note', data: {}, properties: { tags: ['rag'] },
  });
}

beforeEach(async () => {
  sentEvents.length = 0;
  await fs.mkdir(CANVAS_DIR, { recursive: true });
});

afterEach(async () => {
  await fs.rm(join(sandboxHome, '.pulse-coder'), { recursive: true, force: true });
});

describe('canvas_tag_node', () => {
  it('batch-adds a tag across workspaces, storing ids and creating records for untagged nodes', async () => {
    await seed();
    const tools = createTaggingTools();

    const out = JSON.parse(await tools.canvas_tag_node.execute({
      nodes: [
        { nodeId: 'a1', workspaceId: 'ws-a' },
        { nodeId: 'a2', workspaceId: 'ws-a' },
        { nodeId: 'b1', workspaceId: 'ws-b' },
      ],
      addTags: ['AI'], // a NAME — auto-registered as id 'ai'
    }));

    expect(out.ok).toBe(true);
    expect(out.changed).toBe(3);
    // existing rag kept + new ai id appended (stored as ids, not names)
    expect(await tagsOf('ws-a', 'a1')).toEqual(['rag', 'ai']);
    expect(await tagsOf('ws-a', 'a2')).toEqual(['ai']); // metadata merged into existing per-node record
    expect(await tagsOf('ws-b', 'b1')).toEqual(['ai']); // metadata merged into existing per-node record
    // tag was registered in the global store
    expect((await readKnowledgeTags()).map((t) => t.id)).toEqual(expect.arrayContaining(['rag', 'ai']));
    const a2Created = out.results.find((r: { nodeId: string }) => r.nodeId === 'a2');
    expect(a2Created.created).toBe(false);
  });

  it('applies a top-level default workspaceId and merges without duplicating (name vs id)', async () => {
    await seed();
    const tools = createTaggingTools();

    const out = JSON.parse(await tools.canvas_tag_node.execute({
      nodes: [{ nodeId: 'a1' }],
      workspaceId: 'ws-a',
      addTags: ['RAG'], // already present as id 'rag' — must not duplicate
    }));
    expect(out.ok).toBe(true);
    expect(await tagsOf('ws-a', 'a1')).toEqual(['rag']);
  });

  it('removes tags by name or id, replaces via setTags, and clears via clearTags', async () => {
    await seed();
    const tools = createTaggingTools();

    await tools.canvas_tag_node.execute({ nodes: [{ nodeId: 'a1', workspaceId: 'ws-a' }], removeTags: ['RAG'] });
    expect(await tagsOf('ws-a', 'a1')).toEqual([]);

    await tools.canvas_tag_node.execute({ nodes: [{ nodeId: 'a1', workspaceId: 'ws-a' }], setTags: ['AI', 'RAG'] });
    expect(await tagsOf('ws-a', 'a1')).toEqual(['ai', 'rag']);

    await tools.canvas_tag_node.execute({ nodes: [{ nodeId: 'a1', workspaceId: 'ws-a' }], clearTags: true });
    expect(await tagsOf('ws-a', 'a1')).toEqual([]);
  });

  it('ignores empty-array tag fields instead of treating them as override/clear', async () => {
    await seed();
    const tools = createTaggingTools();

    // Problem 1: node-level addTags:[] must NOT shadow the top-level addTags.
    const out1 = JSON.parse(await tools.canvas_tag_node.execute({
      nodes: [{ nodeId: 'a2', workspaceId: 'ws-a', addTags: [] }],
      addTags: ['AI'],
    }));
    expect(out1.changed).toBe(1);
    expect(await tagsOf('ws-a', 'a2')).toEqual(['ai']);
    expect(out1.notes?.some((n: string) => /empty-array/i.test(n))).toBe(true);

    // Problem 2: node-level setTags:[] must NOT clear / cancel the add.
    const out2 = JSON.parse(await tools.canvas_tag_node.execute({
      nodes: [{ nodeId: 'b1', workspaceId: 'ws-b', addTags: ['AI'], setTags: [] }],
    }));
    expect(out2.changed).toBe(1);
    expect(await tagsOf('ws-b', 'b1')).toEqual(['ai']);
  });

  it('reports changed:false (not fake success) when tags do not actually change', async () => {
    await seed();
    const tools = createTaggingTools();

    // a1 already has rag; adding RAG again is a no-op.
    const out = JSON.parse(await tools.canvas_tag_node.execute({
      nodes: [{ nodeId: 'a1', workspaceId: 'ws-a' }],
      addTags: ['RAG'],
    }));
    expect(out.ok).toBe(true);
    expect(out.changed).toBe(0);
    expect(out.unchanged).toBe(1);
    expect(out.results[0].changed).toBe(false);
    expect(await tagsOf('ws-a', 'a1')).toEqual(['rag']);
  });

  it('broadcasts a workspace-node change so open Graph / Nodes views refresh', async () => {
    await seed();
    const tools = createTaggingTools();

    await tools.canvas_tag_node.execute({
      nodes: [{ nodeId: 'a2', workspaceId: 'ws-a' }, { nodeId: 'b1', workspaceId: 'ws-b' }],
      addTags: ['AI'],
    });

    const change = sentEvents.find((e) => e.channel === 'workspace-node:change');
    expect(change).toBeTruthy();
    expect(new Set(change?.payload.workspaceIds)).toEqual(new Set(['ws-a', 'ws-b']));
  });

  it('lets a node override the top-level operation', async () => {
    await seed();
    const tools = createTaggingTools();

    await tools.canvas_tag_node.execute({
      nodes: [
        { nodeId: 'a1', workspaceId: 'ws-a', setTags: ['RAG'] }, // override → just rag
        { nodeId: 'a2', workspaceId: 'ws-a' }, // inherits top-level add
      ],
      addTags: ['AI'],
    });
    expect(await tagsOf('ws-a', 'a1')).toEqual(['rag']);
    expect(await tagsOf('ws-a', 'a2')).toEqual(['ai']);
  });

  it('reports per-node errors without aborting the batch', async () => {
    await seed();
    const tools = createTaggingTools();

    const out = JSON.parse(await tools.canvas_tag_node.execute({
      nodes: [
        { nodeId: 'a2', workspaceId: 'ws-a' }, // ok
        { nodeId: 'ghost', workspaceId: 'ws-a' }, // not found
        { nodeId: 'a1' }, // missing workspaceId
      ],
      addTags: ['AI'],
    }));
    expect(out.ok).toBe(false);
    expect(out.changed).toBe(1);
    expect(out.failed).toBe(2);
    const byId = new Map<string, { ok?: boolean; error?: string }>(
      (out.results as Array<{ nodeId: string; ok?: boolean; error?: string }>).map((r) => [r.nodeId, r]),
    );
    expect(byId.get('a2')?.ok).toBe(true);
    expect(byId.get('ghost')?.error).toMatch(/not found/i);
    expect(byId.get('a1')?.error).toMatch(/workspaceId/i);
  });
});

describe('computeNextTags', () => {
  const index = __testing.buildTagIndex([{ id: 'rag', name: 'RAG' }, { id: 'ai', name: 'AI' }]);

  it('merges add ids onto existing tokens, normalising known names to ids', () => {
    expect(__testing.computeNextTags(['RAG'], { addIds: ['ai'], removeKeys: new Set(), setIds: null }, index))
      .toEqual(['rag', 'ai']); // existing name 'RAG' normalised to id 'rag'
  });

  it('drops removed tokens and dedupes', () => {
    expect(__testing.computeNextTags(['rag', 'ai'], { addIds: [], removeKeys: new Set(['rag']), setIds: null }, index))
      .toEqual(['ai']);
  });

  it('setIds replaces everything', () => {
    expect(__testing.computeNextTags(['rag'], { addIds: ['ai'], removeKeys: new Set(), setIds: ['ai'] }, index))
      .toEqual(['ai']);
  });
});
