import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { searchNodes, updateNode } from '../nodes';
import { saveCanvas, loadCanvas } from '../store';
import { generateContext, CONTEXT_SCHEMA_VERSION } from '../context';
import type { CanvasNode, CanvasSaveData } from '../types';

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `canvas-cli-query-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

const node = (id: string, type: string, title: string, data: Record<string, unknown> = {}): CanvasNode =>
  ({ id, type, title, x: 0, y: 0, width: 100, height: 100, data });

describe('searchNodes', () => {
  const nodes: CanvasNode[] = [
    node('a', 'text', 'Alpha', { content: 'needle in a haystack' }),
    node('b', 'file', 'Beta needle', { content: 'unrelated' }),
    node('c', 'text', 'Gamma', { content: 'nothing here' }),
    node('d', 'iframe', 'Needle embed', { url: 'https://x' }),
  ];

  it('matches title and content, case-insensitively', () => {
    const hits = searchNodes(nodes, 'NEEDLE');
    expect(hits.map(h => h.id).sort()).toEqual(['a', 'b', 'd']);
  });

  it('respects a type filter', () => {
    const hits = searchNodes(nodes, 'needle', { type: 'text' });
    expect(hits.map(h => h.id)).toEqual(['a']);
  });

  it('respects a limit', () => {
    expect(searchNodes(nodes, 'needle', { limit: 2 })).toHaveLength(2);
  });

  it('returns a snippet around the match', () => {
    const [hit] = searchNodes(nodes, 'haystack');
    expect(hit.snippet).toContain('haystack');
  });
});

describe('updateNode', () => {
  it('moves, resizes, and renames a node without touching data', async () => {
    const canvas: CanvasSaveData = {
      nodes: [node('n1', 'text', 'Old', { content: 'keep me' })],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '2025-01-01T00:00:00.000Z',
    };
    await saveCanvas('ws', canvas, testDir);

    const result = await updateNode('ws', 'n1', { x: 300, y: 400, width: 200, title: 'New' }, testDir);
    expect(result.ok).toBe(true);

    const updated = await loadCanvas('ws', testDir);
    const n = updated!.nodes[0];
    expect([n.x, n.y, n.width, n.title]).toEqual([300, 400, 200, 'New']);
    expect(n.data.content).toBe('keep me');
  });

  it('reports node_not_found with a code', async () => {
    await saveCanvas('ws', { nodes: [node('a', 'text', 'A')], transform: { x: 0, y: 0, scale: 1 }, savedAt: '' }, testDir);
    const result = await updateNode('ws', 'missing', { x: 1 }, testDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('node_not_found');
  });
});

describe('generateContext filtering + version', () => {
  async function seed(): Promise<void> {
    const canvas: CanvasSaveData = {
      nodes: [
        node('t1', 'text', 'Note', { content: 'x' }),
        node('f1', 'file', 'Doc', { content: 'y' }),
        node('i1', 'iframe', 'Embed', { url: 'https://x' }),
      ],
      edges: [
        { id: 'e1', source: { kind: 'node', nodeId: 't1' }, target: { kind: 'node', nodeId: 'f1' } },
        { id: 'e2', source: { kind: 'node', nodeId: 't1' }, target: { kind: 'node', nodeId: 'i1' } },
      ],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '2025-01-01T00:00:00.000Z',
    };
    await saveCanvas('ws', canvas, testDir);
  }

  it('stamps the context schema version', async () => {
    await seed();
    const ctx = await generateContext('ws', testDir);
    expect(ctx!.contextVersion).toBe(CONTEXT_SCHEMA_VERSION);
  });

  it('includes only the requested types and drops edges to excluded nodes', async () => {
    await seed();
    const ctx = await generateContext('ws', testDir, { types: ['text', 'file'] });
    expect(ctx!.nodes.map(n => n.type).sort()).toEqual(['file', 'text']);
    // e1 (t1→f1) both included; e2 (t1→i1) dropped because i1 excluded.
    expect(ctx!.edges.map(e => e.id)).toEqual(['e1']);
  });
});
