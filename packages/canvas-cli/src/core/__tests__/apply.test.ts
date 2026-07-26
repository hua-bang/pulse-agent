import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { applyPlan } from '../apply';
import { loadCanvas, getWorkspaceDir } from '../store';
import { writeNodeFile, readNodeFile, PER_NODE_SCHEMA_VERSION } from '../storage-v2';
import type { CanvasNode, CanvasSaveData } from '../types';

let testDir: string;
const wsId = 'ws-apply-test';

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `canvas-cli-apply-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

function textNode(id: string, content = 'body'): CanvasNode {
  return { id, type: 'text', title: id, x: 0, y: 0, width: 100, height: 80, data: { content }, updatedAt: 1 } as CanvasNode;
}

async function seedV1(nodes: CanvasNode[], extra: Partial<CanvasSaveData> = {}): Promise<string> {
  const wsDir = getWorkspaceDir(wsId, testDir);
  await fs.mkdir(wsDir, { recursive: true });
  const canvas: CanvasSaveData = {
    nodes,
    edges: [],
    transform: { x: 0, y: 0, scale: 1 },
    savedAt: new Date().toISOString(),
    ...extra,
  };
  await fs.writeFile(join(wsDir, 'canvas.json'), JSON.stringify(canvas));
  return wsDir;
}

describe('applyPlan: atomic batch', () => {
  it('creates nodes and edges in one save, stamping a revision', async () => {
    const wsDir = await seedV1([textNode('seed')]);

    const result = await applyPlan(wsId, {
      operations: [
        { action: 'create', type: 'file', id: 'card-a', title: 'Card A', x: 10, y: 10, content: '# body A' },
        // NOTE: creatable types mirror `node create` (text/iframe/image are
        // the A5 gap, to be extended in BOTH paths through the parity gate).
        { action: 'create', type: 'file', id: 'card-b', title: 'Card B', content: 'body B' },
        {
          action: 'createEdge',
          id: 'e1',
          from: 'card-a',
          to: 'card-b',
          label: 'supports',
          labelStyle: { color: '#7c2d12', backgroundColor: '#ffedd5' },
        },
      ],
    }, { storeDir: testDir });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.created).toEqual(['card-a', 'card-b']);
    expect(result.data.edgesCreated).toEqual(['e1']);
    expect(result.data.revision).toBe(1);

    const canvas = await loadCanvas(wsId, testDir);
    expect(canvas?.nodes.map(n => n.id).sort()).toEqual(['card-a', 'card-b', 'seed']);
    expect(canvas?.edges?.map(e => e.id)).toEqual(['e1']);
    expect(canvas?.edges?.[0]).toMatchObject({
      labelStyle: { color: '#7c2d12', backgroundColor: '#ffedd5' },
    });
    expect(canvas?.edges?.[0].updatedAt).toEqual(expect.any(Number));
    // File node got a real backing markdown file with the plan's content.
    const cardA = canvas?.nodes.find(n => n.id === 'card-a');
    expect(String(cardA?.data.filePath)).toContain(join(wsDir, 'notes'));
    expect(await fs.readFile(String(cardA?.data.filePath), 'utf-8')).toBe('# body A');
  });

  it('aborts the WHOLE plan when any op fails — no partial writes', async () => {
    const wsDir = await seedV1([textNode('seed')]);

    const result = await applyPlan(wsId, {
      operations: [
        { action: 'create', type: 'file', id: 'card-a', title: 'Card A', content: 'leak?' },
        { action: 'update', id: 'does-not-exist', title: 'boom' },
      ],
    }, { storeDir: testDir });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('node_not_found');
    expect(result.error).toContain('operation[1]');

    const canvas = await loadCanvas(wsId, testDir);
    expect(canvas?.nodes.map(n => n.id)).toEqual(['seed']);
    expect(canvas?.revision).toBeUndefined();
    // The deferred-writes design must not leak the note file.
    await expect(fs.access(join(wsDir, 'notes'))).rejects.toThrow();
  });

  it('dry-run validates without touching disk', async () => {
    const wsDir = await seedV1([textNode('seed')]);
    const result = await applyPlan(wsId, {
      operations: [
        { action: 'create', type: 'file', id: 'card-a', title: 'A', content: 'x' },
      ],
    }, { storeDir: testDir, dryRun: true });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.dryRun).toBe(true);
    expect(result.data.created).toEqual(['card-a']);
    const canvas = await loadCanvas(wsId, testDir);
    expect(canvas?.nodes.map(n => n.id)).toEqual(['seed']);
    await expect(fs.access(join(wsDir, 'notes'))).rejects.toThrow();
  });
});

describe('applyPlan: optimistic concurrency', () => {
  it('rejects a stale baseRevision without changes', async () => {
    await seedV1([textNode('seed')], { revision: 5 });
    const result = await applyPlan(wsId, {
      baseRevision: 4,
      operations: [{ action: 'update', id: 'seed', title: 'nope' }],
    }, { storeDir: testDir });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('revision_conflict');
    expect((await loadCanvas(wsId, testDir))?.nodes[0].title).toBe('seed');
  });

  it('accepts a matching baseRevision and bumps it', async () => {
    await seedV1([textNode('seed')], { revision: 5 });
    const result = await applyPlan(wsId, {
      baseRevision: 5,
      operations: [{ action: 'update', id: 'seed', title: 'renamed' }],
    }, { storeDir: testDir });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.revision).toBe(6);
    expect((await loadCanvas(wsId, testDir))?.nodes[0].title).toBe('renamed');
  });

  it('rejects baseRevision against a canvas that has never been stamped', async () => {
    await seedV1([textNode('seed')]);
    const result = await applyPlan(wsId, {
      baseRevision: 1,
      operations: [{ action: 'update', id: 'seed', title: 'nope' }],
    }, { storeDir: testDir });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('revision_conflict');
  });
});

describe('applyPlan: guards', () => {
  it('rejects a plan pinned to a different workspace', async () => {
    await seedV1([textNode('seed')]);
    const result = await applyPlan(wsId, {
      workspace: 'some-other-ws',
      operations: [{ action: 'delete', id: 'seed' }],
    }, { storeDir: testDir });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('workspace_mismatch');
  });

  it('updates file-node content through the shared write semantics', async () => {
    const wsDir = await seedV1([]);
    await fs.mkdir(join(wsDir, 'notes'), { recursive: true });
    const mdPath = join(wsDir, 'notes', 'card.md');
    await fs.writeFile(mdPath, 'old', 'utf-8');
    await seedV1([
      {
        id: 'card',
        type: 'file',
        title: 'Card',
        x: 0, y: 0, width: 100, height: 80,
        data: { filePath: mdPath, content: 'old' },
        updatedAt: 1,
      } as CanvasNode,
    ]);

    const result = await applyPlan(wsId, {
      operations: [{ action: 'update', id: 'card', content: 'new body' }],
    }, { storeDir: testDir });

    expect(result.ok).toBe(true);
    expect(await fs.readFile(mdPath, 'utf-8')).toBe('new body');
    expect((await loadCanvas(wsId, testDir))?.nodes[0].data.content).toBe('new body');
  });
});

describe('applyPlan: deletes on v2 workspaces', () => {
  it('removes per-node files for deleted nodes and prunes their edges', async () => {
    const wsDir = getWorkspaceDir(wsId, testDir);
    await fs.mkdir(wsDir, { recursive: true });
    const layout = {
      schemaVersion: 2,
      nodes: [
        { id: 'keep', type: 'text', title: 'keep', x: 0, y: 0, width: 100, height: 80 },
        { id: 'drop', type: 'text', title: 'drop', x: 200, y: 0, width: 100, height: 80 },
      ],
      edges: [
        { id: 'e-kept', source: { kind: 'node', nodeId: 'keep' }, target: { kind: 'point', x: 1, y: 1 } },
        { id: 'e-doomed', source: { kind: 'node', nodeId: 'keep' }, target: { kind: 'node', nodeId: 'drop' } },
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: new Date().toISOString(),
    };
    await fs.writeFile(join(wsDir, 'canvas.json'), JSON.stringify(layout));
    for (const id of ['keep', 'drop']) {
      await writeNodeFile(wsDir, {
        schemaVersion: PER_NODE_SCHEMA_VERSION,
        id,
        type: 'text',
        data: { content: id },
        updatedAt: 1,
      });
    }

    const result = await applyPlan(wsId, {
      operations: [{ action: 'delete', id: 'drop' }],
    }, { storeDir: testDir });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.prunedEdges).toEqual(['e-doomed']);
    expect(await readNodeFile(wsDir, 'drop')).toBeNull();
    expect(await readNodeFile(wsDir, 'keep')).not.toBeNull();
    const canvas = await loadCanvas(wsId, testDir);
    expect(canvas?.edges?.map(e => e.id)).toEqual(['e-kept']);
  });
});
