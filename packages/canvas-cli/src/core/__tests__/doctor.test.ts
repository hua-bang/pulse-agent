import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { runDoctor } from '../doctor';
import { writeNodeFile, readNodeFile, getNodesDir, PER_NODE_SCHEMA_VERSION } from '../storage-v2';
import { loadCanvas, getWorkspaceDir } from '../store';
import type { CanvasNode, CanvasSaveData } from '../types';

let testDir: string;
const wsId = 'ws-doctor-test';

beforeEach(async () => {
  testDir = join(
    tmpdir(),
    `canvas-cli-doctor-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  );
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

interface SeedNode {
  node: CanvasNode;
  /** Omit to skip writing the per-node file (missing_node_file scenario). */
  perNodeFile?: boolean;
}

async function seedV2(seeds: SeedNode[], edges: CanvasSaveData['edges'] = []): Promise<string> {
  const wsDir = getWorkspaceDir(wsId, testDir);
  await fs.mkdir(wsDir, { recursive: true });
  const layout = {
    schemaVersion: 2,
    nodes: seeds.map(({ node }) => {
      const { data: _d, ...rest } = node;
      return rest;
    }),
    edges,
    transform: { x: 0, y: 0, scale: 1 },
    savedAt: new Date().toISOString(),
  };
  await fs.writeFile(join(wsDir, 'canvas.json'), JSON.stringify(layout));
  for (const { node, perNodeFile = true } of seeds) {
    if (!perNodeFile) continue;
    await writeNodeFile(wsDir, {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: node.id,
      type: node.type,
      title: node.title,
      data: node.data,
      updatedAt: node.updatedAt ?? 1,
    });
  }
  return wsDir;
}

function fileNode(id: string, filePath: string, content: string): CanvasNode {
  return {
    id,
    type: 'file',
    title: id,
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    data: { filePath, content, saved: true, modified: false },
    updatedAt: 1,
  };
}

describe('doctor: markdown ↔ data.content', () => {
  it('repairs drift with markdown as the winner (the empty-card incident)', async () => {
    const wsDir = getWorkspaceDir(wsId, testDir);
    const mdPath = join(wsDir, 'notes', 'card.md');
    await fs.mkdir(join(wsDir, 'notes'), { recursive: true });
    await fs.writeFile(mdPath, 'the real body', 'utf-8');
    await seedV2([{ node: fileNode('n1', mdPath, '') }]);

    const check = await runDoctor(wsId, { storeDir: testDir });
    const drift = check.findings.find(f => f.kind === 'content_drift');
    expect(drift?.nodeId).toBe('n1');
    expect(drift?.repaired).toBeUndefined();
    // Drift with a recoverable markdown body must not double-report as empty.
    expect(check.findings.some(f => f.kind === 'empty_body' && f.nodeId === 'n1')).toBe(false);

    const repaired = await runDoctor(wsId, { storeDir: testDir, repair: true });
    expect(repaired.findings.find(f => f.kind === 'content_drift')?.repaired).toBe(true);
    const canvas = await loadCanvas(wsId, testDir);
    expect(canvas?.nodes.find(n => n.id === 'n1')?.data.content).toBe('the real body');
  });

  it('recreates a missing backing markdown file from data.content', async () => {
    const wsDir = getWorkspaceDir(wsId, testDir);
    const mdPath = join(wsDir, 'notes', 'gone.md');
    await seedV2([{ node: fileNode('n1', mdPath, 'only inline copy') }]);

    const repaired = await runDoctor(wsId, { storeDir: testDir, repair: true });
    expect(repaired.findings.find(f => f.kind === 'missing_backing_file')?.repaired).toBe(true);
    expect(await fs.readFile(mdPath, 'utf-8')).toBe('only inline copy');
  });

  it('reports but never touches paths outside the workspace', async () => {
    const outside = join(testDir, 'elsewhere.md');
    await fs.writeFile(outside, 'external', 'utf-8');
    await seedV2([{ node: fileNode('n1', outside, 'different') }]);

    const repaired = await runDoctor(wsId, { storeDir: testDir, repair: true });
    const f = repaired.findings.find(x => x.kind === 'path_outside_workspace');
    expect(f?.repairable).toBe(false);
    expect(await fs.readFile(outside, 'utf-8')).toBe('external'); // untouched
  });

  it('reports empty bodies as unrecoverable', async () => {
    const wsDir = getWorkspaceDir(wsId, testDir);
    const mdPath = join(wsDir, 'notes', 'empty.md');
    await fs.mkdir(join(wsDir, 'notes'), { recursive: true });
    await fs.writeFile(mdPath, '', 'utf-8');
    await seedV2([{ node: fileNode('n1', mdPath, '') }]);

    const report = await runDoctor(wsId, { storeDir: testDir, repair: true });
    const f = report.findings.find(x => x.kind === 'empty_body');
    expect(f?.nodeId).toBe('n1');
    expect(f?.repairable).toBe(false);
  });
});

describe('doctor: v2 layout ↔ per-node files', () => {
  it('adopts orphan per-node files back onto the canvas', async () => {
    const wsDir = await seedV2([{ node: fileNode('kept', join(getWorkspaceDir(wsId, testDir), 'notes', 'k.md'), 'x') }]);
    await fs.mkdir(join(wsDir, 'notes'), { recursive: true });
    await fs.writeFile(join(wsDir, 'notes', 'k.md'), 'x', 'utf-8');
    await writeNodeFile(wsDir, {
      schemaVersion: PER_NODE_SCHEMA_VERSION,
      id: 'lost-node',
      type: 'text',
      title: 'Survivor',
      data: { content: 'body that survived the race' },
      updatedAt: 5,
    });

    const check = await runDoctor(wsId, { storeDir: testDir });
    expect(check.findings.find(f => f.kind === 'orphan_node_file')?.nodeId).toBe('lost-node');

    await runDoctor(wsId, { storeDir: testDir, repair: true });
    const canvas = await loadCanvas(wsId, testDir);
    const adopted = canvas?.nodes.find(n => n.id === 'lost-node');
    expect(adopted?.type).toBe('text');
    expect(adopted?.data.content).toBe('body that survived the race');
  });

  it('rematerializes missing per-node files for layout entries', async () => {
    const wsDir = await seedV2([
      { node: { id: 'ghost', type: 'text', title: 'Ghost', x: 0, y: 0, width: 100, height: 80, data: {} }, perNodeFile: false },
    ]);

    const check = await runDoctor(wsId, { storeDir: testDir });
    expect(check.findings.find(f => f.kind === 'missing_node_file')?.nodeId).toBe('ghost');

    await runDoctor(wsId, { storeDir: testDir, repair: true });
    expect(await readNodeFile(wsDir, 'ghost')).not.toBeNull();
  });

  it('deletes only stale tmp artifacts', async () => {
    const wsDir = await seedV2([
      { node: { id: 'n1', type: 'text', title: '', x: 0, y: 0, width: 1, height: 1, data: { content: 'x' } } },
    ]);
    const staleTmp = join(getNodesDir(wsDir), 'n1.json.123.456.abc.tmp');
    const freshTmp = join(getNodesDir(wsDir), 'n1.json.789.012.def.tmp');
    await fs.writeFile(staleTmp, '{}', 'utf-8');
    await fs.writeFile(freshTmp, '{}', 'utf-8');
    const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(staleTmp, past, past);

    await runDoctor(wsId, { storeDir: testDir, repair: true });
    await expect(fs.access(staleTmp)).rejects.toThrow();
    await expect(fs.access(freshTmp)).resolves.toBeUndefined();
  });
});

describe('doctor: edges', () => {
  it('reports dangling edges in check mode and prunes them on repair', async () => {
    await seedV2(
      [{ node: { id: 'n1', type: 'text', title: '', x: 0, y: 0, width: 1, height: 1, data: { content: 'x' } } }],
      [
        {
          id: 'e-ok',
          source: { kind: 'node', nodeId: 'n1' },
          target: { kind: 'point', x: 10, y: 10 },
        },
        {
          id: 'e-dangling',
          source: { kind: 'node', nodeId: 'n1' },
          target: { kind: 'node', nodeId: 'deleted-node' },
        },
      ],
    );

    const check = await runDoctor(wsId, { storeDir: testDir });
    expect(check.findings.find(f => f.kind === 'dangling_edge')?.edgeId).toBe('e-dangling');
    expect((await loadCanvas(wsId, testDir))?.edges).toHaveLength(2); // untouched

    await runDoctor(wsId, { storeDir: testDir, repair: true });
    const edges = (await loadCanvas(wsId, testDir))?.edges ?? [];
    expect(edges.map(e => e.id)).toEqual(['e-ok']);
  });
});
