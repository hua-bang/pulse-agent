import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { readNode, writeNode } from '../nodes';
import { saveCanvas, loadCanvas, getWorkspaceDir } from '../store';
import type { CanvasNode, CanvasSaveData } from '../types';

let testDir: string;

beforeEach(async () => {
  testDir = join(tmpdir(), `canvas-cli-sec-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(testDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

function fileNode(id: string, filePath: string, content = ''): CanvasNode {
  return { id, type: 'file', title: 'F', x: 0, y: 0, width: 100, height: 100, data: { filePath, content } };
}

describe('file-node path confinement', () => {
  it('reads a file whose path is inside the workspace as usual', async () => {
    const wsDir = getWorkspaceDir('ws-c', testDir);
    await fs.mkdir(join(wsDir, 'notes'), { recursive: true });
    const inside = join(wsDir, 'notes', 'n.md');
    await fs.writeFile(inside, 'inside content', 'utf-8');

    const node = fileNode('n1', inside, 'stale');
    const result = await readNode(node, { confineToDir: wsDir });
    expect(result.content).toBe('inside content');
    expect(result.pathConfined).toBeUndefined();
  });

  it('does NOT read a file outside the workspace under confinement (no disk leak)', async () => {
    const wsDir = getWorkspaceDir('ws-c', testDir);
    const secret = join(testDir, 'secret.txt');
    await fs.writeFile(secret, 'TOP SECRET', 'utf-8');

    const node = fileNode('n1', secret, 'in-memory only');
    const result = await readNode(node, { confineToDir: wsDir });
    expect(result.pathConfined).toBe(true);
    expect(result.content).toBe('in-memory only');
    expect(String(result.content)).not.toContain('TOP SECRET');
  });

  it('still reads the escaping path when confinement is off (default behavior)', async () => {
    const wsDir = getWorkspaceDir('ws-c', testDir);
    const outside = join(testDir, 'outside.txt');
    await fs.writeFile(outside, 'outside content', 'utf-8');

    const node = fileNode('n1', outside, 'stale');
    const result = await readNode(node); // no confineToDir
    expect(result.content).toBe('outside content');
    expect(result.pathConfined).toBeUndefined();
    // sanity: confinement would have blocked it
    expect((await readNode(node, { confineToDir: wsDir })).pathConfined).toBe(true);
  });

  it('refuses to write a file node whose path escapes the workspace under confinement', async () => {
    const outside = join(testDir, 'victim.txt');
    await fs.writeFile(outside, 'original', 'utf-8');
    const canvas: CanvasSaveData = {
      nodes: [fileNode('n1', outside)],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '2025-01-01T00:00:00.000Z',
    };
    await saveCanvas('ws-w', canvas, testDir);

    const result = await writeNode('ws-w', 'n1', 'HACKED', testDir, { confineToWorkspace: true });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('path_confined');
    // The outside file must be untouched.
    expect(await fs.readFile(outside, 'utf-8')).toBe('original');
  });

  it('allows the write when confinement is off', async () => {
    const outside = join(testDir, 'victim2.txt');
    await fs.writeFile(outside, 'original', 'utf-8');
    const canvas: CanvasSaveData = {
      nodes: [fileNode('n1', outside)],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '2025-01-01T00:00:00.000Z',
    };
    await saveCanvas('ws-w2', canvas, testDir);

    const result = await writeNode('ws-w2', 'n1', 'new', testDir); // no confinement
    expect(result.ok).toBe(true);
    expect(await fs.readFile(outside, 'utf-8')).toBe('new');
  });
});

describe('text node write', () => {
  it('updates a text node content in place', async () => {
    const canvas: CanvasSaveData = {
      nodes: [{ id: 't1', type: 'text', title: 'Note', x: 0, y: 0, width: 100, height: 100, data: { content: 'old' } }],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '2025-01-01T00:00:00.000Z',
    };
    await saveCanvas('ws-t', canvas, testDir);

    const result = await writeNode('ws-t', 't1', '# New body', testDir);
    expect(result.ok).toBe(true);

    const updated = await loadCanvas('ws-t', testDir);
    expect(updated!.nodes[0].data.content).toBe('# New body');
  });

  it('reports unsupported with a code for a type that cannot be written', async () => {
    const canvas: CanvasSaveData = {
      nodes: [{ id: 'i1', type: 'iframe', title: 'V', x: 0, y: 0, width: 100, height: 100, data: { url: 'x' } }],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: '2025-01-01T00:00:00.000Z',
    };
    await saveCanvas('ws-i', canvas, testDir);

    const result = await writeNode('ws-i', 'i1', 'nope', testDir);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('unsupported');
  });
});
