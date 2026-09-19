import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readCanvasFull, writeCanvasFull } from '../storage';
import { readWorkspaceNode, writeWorkspaceNode } from '../nodes/store';
import { activateCanvasSqlite } from './activate-sqlite';
import { closeCanvasStorage, getLocalCanvasStorage } from './backend';

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'canvas-sqlite-host-')); });
afterEach(async () => {
  await closeCanvasStorage();
  await rm(root, { recursive: true, force: true });
});

describe('Canvas host SQLite cutover', () => {
  it('migrates ordered v2 layout, off-canvas nodes, and keeps Markdown unchanged', async () => {
    const note = join(root, 'ws', 'notes', 'a.md');
    await mkdir(join(root, 'ws', 'notes'), { recursive: true });
    await writeFile(note, 'external content');
    await writeCanvasFull('ws', {
      nodes: [
        { id: 'z', type: 'file', x: 1, y: 2, data: { filePath: note, content: 'external content' } },
        { id: 'a', type: 'text', x: 20, y: 30, data: { content: 'hello' } },
      ],
      edges: [{ id: 'edge', label: 'relation' }],
      transform: { x: 0, y: 0, scale: 1 },
    }, root);
    await writeWorkspaceNode('ws', {
      schemaVersion: 1, id: 'offcanvas', type: 'plugin', data: { payload: { future: [1, 2] } },
    }, root);
    const oldLayout = await readFile(join(root, 'ws', 'canvas.json'), 'utf8');

    await activateCanvasSqlite(root);
    const loaded = await readCanvasFull('ws', root);
    expect(loaded.data?.nodes?.map(node => node.id)).toEqual(['z', 'a']);
    expect(loaded.data?.revision).toBe(1);
    expect((await readWorkspaceNode('ws', 'offcanvas', root))?.data).toEqual({ payload: { future: [1, 2] } });
    expect(await readFile(note, 'utf8')).toBe('external content');
    expect(await readFile(join(root, 'ws', 'canvas.json'), 'utf8')).toBe(oldLayout);
  });

  it('does not let stale full saves overwrite independent node mutations', async () => {
    await writeCanvasFull('ws', { nodes: [{ id: 'n', type: 'text', data: { content: 'before' } }] }, root);
    await activateCanvasSqlite(root);
    const stale = (await readCanvasFull('ws', root)).data!;
    await writeWorkspaceNode('ws', {
      schemaVersion: 1, id: 'n', type: 'text', data: { content: 'from another writer' },
    }, root);
    stale.nodes![0].data = { content: 'stale' };
    await expect(writeCanvasFull('ws', stale, root)).rejects.toMatchObject({ code: 'revision_conflict' });
    expect((await readCanvasFull('ws', root)).data?.nodes?.[0].data?.content).toBe('from another writer');
  });

  it('ignores legacy JSON writes after activation and saves only into SQLite', async () => {
    await writeCanvasFull('ws', { nodes: [{ id: 'n', type: 'text', data: { content: 'kept' } }] }, root);
    await activateCanvasSqlite(root);
    await writeFile(join(root, 'ws', 'canvas.json'), JSON.stringify({ nodes: [] }));
    const current = (await readCanvasFull('ws', root)).data!;
    expect(current.nodes).toHaveLength(1);
    current.nodes![0].title = 'changed';
    await writeCanvasFull('ws', current, root);
    expect(current.revision).toBe(2);
    expect((await readCanvasFull('ws', root)).data?.nodes?.[0].title).toBe('changed');
    expect(JSON.parse(await readFile(join(root, 'ws', 'canvas.json'), 'utf8'))).toEqual({ nodes: [] });
  });

  it('imports a legacy flat canvas without moving or deleting the source file', async () => {
    const original = JSON.stringify({ nodes: [{ id: 'n', type: 'text', data: { content: 'old format' } }] });
    await writeFile(join(root, 'flat.json'), original);
    await activateCanvasSqlite(root);
    expect((await readCanvasFull('flat', root)).data?.nodes?.[0].data?.content).toBe('old format');
    expect(await readFile(join(root, 'flat.json'), 'utf8')).toBe(original);
  });

  it('refuses corrupt node records instead of publishing a partial migration', async () => {
    await writeCanvasFull('ws', { nodes: [{ id: 'n', type: 'text', data: { content: 'kept' } }] }, root);
    await writeFile(join(root, 'ws', 'nodes', 'n.json'), '{broken');
    await expect(activateCanvasSqlite(root)).rejects.toBeTruthy();
    expect(await getLocalCanvasStorage(root)).toBeNull();
  });

  it.each([1, 2])('preserves known v%s content and unknown plugin fields on first upgrade', async version => {
    const legacy = {
      schemaVersion: version as 1 | 2,
      nodes: [{ id: 'plugin', type: 'plugin', data: { pluginId: 'future', payload: { custom: ['a'] } } }],
      edges: [{ id: 'edge', payload: { custom: true } }],
      futureMetadata: { keep: true },
    };
    await writeCanvasFull('ws', legacy, root);
    await activateCanvasSqlite(root);
    const data = (await readCanvasFull('ws', root)).data!;
    expect(data.nodes?.[0].data).toEqual({ pluginId: 'future', payload: { custom: ['a'] } });
    expect(data.edges).toEqual([{ id: 'edge', payload: { custom: true } }]);
    expect((data as unknown as Record<string, unknown>).futureMetadata).toEqual({ keep: true });
  });

  it('rejects a future layout version without changing old data or activating SQLite', async () => {
    const path = join(root, 'ws', 'canvas.json');
    await mkdir(join(root, 'ws'));
    const original = JSON.stringify({ schemaVersion: 99, nodes: [{ id: 'future', type: 'unknown' }] });
    await writeFile(path, original);
    await expect(activateCanvasSqlite(root)).rejects.toMatchObject({ code: 'unsupported_schema' });
    expect(await readFile(path, 'utf8')).toBe(original);
    expect(await getLocalCanvasStorage(root)).toBeNull();
  });

  it('does not migrate a missing v2 body into an empty node', async () => {
    await writeCanvasFull('ws', { nodes: [{ id: 'n', type: 'text', data: { content: 'kept' } }] }, root);
    await rm(join(root, 'ws', 'nodes', 'n.json'));
    await expect(activateCanvasSqlite(root)).rejects.toMatchObject({ code: 'corrupt_data' });
    expect(await getLocalCanvasStorage(root)).toBeNull();
  });

  it('rejects a pre-upgrade snapshot even when legacy and SQLite revisions are equal', async () => {
    await writeCanvasFull('ws', {
      revision: 1,
      nodes: [{ id: 'n', type: 'text', data: { content: 'before upgrade' } }],
    }, root);
    const oldSnapshot = (await readCanvasFull('ws', root)).data!;
    await activateCanvasSqlite(root);
    const current = (await readCanvasFull('ws', root)).data!;
    expect(oldSnapshot.revision).toBe(current.revision);
    expect(current.storageGeneration).toEqual(expect.any(String));
    oldSnapshot.nodes![0].data = { content: 'stale process' };
    await expect(writeCanvasFull('ws', oldSnapshot, root)).rejects.toMatchObject({ code: 'revision_conflict' });
    expect((await readCanvasFull('ws', root)).data?.nodes?.[0].data?.content).toBe('before upgrade');
  });
});
