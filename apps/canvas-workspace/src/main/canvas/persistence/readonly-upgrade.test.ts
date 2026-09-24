import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activateCanvasSqlite } from './activate-sqlite';
import { closeCanvasStorage, getLocalCanvasStorage } from './backend';
import { readCanvasFull } from '../storage';
import { readWorkspaceNode } from '../nodes/store';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'canvas-readonly-upgrade-'));
  await mkdir(join(root, 'ws', 'nodes'), { recursive: true });
});
afterEach(async () => {
  await closeCanvasStorage();
  await rm(root, { recursive: true, force: true });
});

const source = {
  nodes: [{ id: 'n', type: 'text', title: 'Original', x: 1, y: 2, data: { content: 'complete v1 body' }, updatedAt: 7 }],
  edges: [], future: { preserve: true },
};
const sentinel = { workspaceId: 'ws', startedAt: 10, sourceUpdatedAt: 7, expectedNodeIds: ['n'] };

async function seed(name: string, value: unknown): Promise<string> {
  const raw = typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(join(root, 'ws', name), raw);
  return raw;
}

describe('read-only Canvas upgrade', () => {
  it('imports an intact v1 with an interrupted split without deleting or rewriting any legacy evidence', async () => {
    const layout = await seed('canvas.json', source);
    const backup = await seed('canvas.json.v1.bak', source);
    const marker = await seed('.migrating', sentinel);
    const partial = await seed('nodes/n.json', '{incomplete split');
    const offcanvas = await seed('nodes/off.json', { schemaVersion: 1, id: 'off', type: 'plugin', data: { payload: { future: [1, 2] } } });
    await activateCanvasSqlite(root);
    expect((await readCanvasFull('ws', root)).data?.nodes?.[0].data?.content).toBe('complete v1 body');
    expect((await readWorkspaceNode('ws', 'off', root))?.data).toEqual({ payload: { future: [1, 2] } });
    for (const [name, raw] of Object.entries({
      'canvas.json': layout, 'canvas.json.v1.bak': backup, '.migrating': marker,
      'nodes/n.json': partial, 'nodes/off.json': offcanvas,
    })) expect(await readFile(join(root, 'ws', name), 'utf8')).toBe(raw);
  });

  it('reads the v1 backup when layout is missing without restoring files or cleaning partial atoms', async () => {
    const backup = await seed('canvas.json.v1.bak', source);
    const marker = await seed('.migrating', sentinel);
    const partial = await seed('nodes/n.json', { schemaVersion: 1, id: 'n', type: 'text', data: { content: 'partial' } });
    await activateCanvasSqlite(root);
    expect((await readCanvasFull('ws', root)).data?.nodes?.[0].data?.content).toBe('complete v1 body');
    await expect(stat(join(root, 'ws', 'canvas.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(root, 'ws', 'canvas.json.v1.bak'), 'utf8')).toBe(backup);
    expect(await readFile(join(root, 'ws', '.migrating'), 'utf8')).toBe(marker);
    expect(await readFile(join(root, 'ws', 'nodes/n.json'), 'utf8')).toBe(partial);
  });

  it('imports a verified v1 backup after an interrupted migration corrupted the layout, preserving every source byte', async () => {
    const files = {
      'canvas.json': await seed('canvas.json', '{broken layout'),
      'canvas.json.v1.bak': await seed('canvas.json.v1.bak', source),
      '.migrating': await seed('.migrating', sentinel),
      'nodes/n.json': await seed('nodes/n.json', '{partial node'),
      'nodes/off.json': await seed('nodes/off.json', { schemaVersion: 1, id: 'off', type: 'plugin', data: { payload: { keep: true } } }),
      'note.md': await seed('note.md', 'Keep external Markdown'),
    };
    await activateCanvasSqlite(root);
    expect((await readCanvasFull('ws', root)).data).toMatchObject({
      nodes: [{ id: 'n', data: { content: 'complete v1 body' } }], future: { preserve: true },
    });
    expect((await readWorkspaceNode('ws', 'off', root))?.data).toEqual({ payload: { keep: true } });

    const storage = (await getLocalCanvasStorage(root))!;
    const snapshot = (await storage.canvas.read('ws'))!;
    const original = snapshot.nodes.find(node => node.id === 'n')!;
    await storage.canvas.commit({
      workspaceId: 'ws', expectedRevision: snapshot.revision,
      nodes: { put: [{ ...original, data: { content: 'New SQL edit' } }] },
    });
    await closeCanvasStorage();
    await activateCanvasSqlite(root);
    expect((await readCanvasFull('ws', root)).data?.nodes?.[0].data?.content).toBe('New SQL edit');
    for (const [name, bytes] of Object.entries(files)) {
      expect(await readFile(join(root, 'ws', name), 'utf8')).toBe(bytes);
    }
  });

  it.each(['missing', 'malformed', 'future', 'v2', 'ids', 'timestamp'] as const)(
    'rejects a %s v1 backup when the interrupted primary is malformed', async kind => {
      const layout = await seed('canvas.json', '{broken layout');
      const marker = await seed('.migrating', sentinel);
      const backup = kind === 'missing' ? null : await seed('canvas.json.v1.bak',
        kind === 'malformed' ? '{broken backup'
          : kind === 'future' ? { ...source, schemaVersion: 99 }
            : kind === 'v2' ? { ...source, schemaVersion: 2 }
              : kind === 'ids' ? { ...source, nodes: [{ ...source.nodes[0], id: 'different' }] }
                : { ...source, nodes: [{ ...source.nodes[0], updatedAt: 8 }] });
      await expect(activateCanvasSqlite(root)).rejects.toMatchObject({
        code: kind === 'future' ? 'unsupported_schema' : 'corrupt_data',
      });
      expect(await getLocalCanvasStorage(root)).toBeNull();
      expect(await readFile(join(root, 'ws', 'canvas.json'), 'utf8')).toBe(layout);
      expect(await readFile(join(root, 'ws', '.migrating'), 'utf8')).toBe(marker);
      if (backup !== null) expect(await readFile(join(root, 'ws', 'canvas.json.v1.bak'), 'utf8')).toBe(backup);
    },
  );

  it('does not replace a structurally invalid primary with an older v1 backup', async () => {
    const layout = await seed('canvas.json', { schemaVersion: 1, nodes: 'invalid records' });
    await seed('.migrating', sentinel);
    await seed('canvas.json.v1.bak', source);
    await expect(activateCanvasSqlite(root)).rejects.toMatchObject({ code: 'corrupt_data' });
    expect(await getLocalCanvasStorage(root)).toBeNull();
    expect(await readFile(join(root, 'ws', 'canvas.json'), 'utf8')).toBe(layout);
  });

  it.each(['future-layout', 'future-backup', 'future-atom'])('does not downgrade %s through an older recovery snapshot', async kind => {
    await seed('.migrating', sentinel);
    await seed('canvas.json.v1.bak', kind === 'future-backup' ? { ...source, schemaVersion: 99 } : source);
    if (kind !== 'future-backup') await seed('canvas.json', kind === 'future-layout' ? { ...source, schemaVersion: 99 } : source);
    if (kind === 'future-atom') await seed('nodes/n.json', { schemaVersion: 99, id: 'n', type: 'text', data: { content: 'future' } });
    await expect(activateCanvasSqlite(root)).rejects.toMatchObject({ code: 'unsupported_schema' });
    expect(await getLocalCanvasStorage(root)).toBeNull();
    expect(await readFile(join(root, 'ws', '.migrating'), 'utf8')).toBe(`${JSON.stringify(sentinel, null, 2)}\n`);
  });

  it('fails closed when a sentinel does not describe the intact v1 source', async () => {
    await seed('canvas.json', source);
    const raw = await seed('.migrating', { ...sentinel, expectedNodeIds: ['unrelated'] });
    await expect(activateCanvasSqlite(root)).rejects.toMatchObject({ code: 'corrupt_data' });
    expect(await getLocalCanvasStorage(root)).toBeNull();
    expect(await readFile(join(root, 'ws', '.migrating'), 'utf8')).toBe(raw);
  });

  it('projects committed v2 atoms over stale layout fields without deleting the old sentinel', async () => {
    const layout = await seed('canvas.json', { schemaVersion: 2, nodes: [{ id: 'n', type: 'text', title: 'Stale', x: 5, y: 6 }] });
    const marker = await seed('.migrating', sentinel);
    const atom = await seed('nodes/n.json', {
      schemaVersion: 1, id: 'n', type: 'plugin', title: 'Canonical', updatedAt: 9,
      data: { payload: { preserve: ['future'] } }, properties: { custom: 'value' }, links: [{ relation: 'source', target: { nodeId: 'off' } }],
    });
    await activateCanvasSqlite(root);
    expect((await readCanvasFull('ws', root)).data?.nodes?.[0]).toMatchObject({
      type: 'plugin', title: 'Canonical', x: 5, y: 6, updatedAt: 9,
      data: { payload: { preserve: ['future'] } }, properties: { custom: 'value' },
    });
    expect(await readFile(join(root, 'ws', 'canvas.json'), 'utf8')).toBe(layout);
    expect(await readFile(join(root, 'ws', '.migrating'), 'utf8')).toBe(marker);
    expect(await readFile(join(root, 'ws', 'nodes/n.json'), 'utf8')).toBe(atom);
  });

  it('keeps a flat legacy layout when its directory already contains off-canvas records', async () => {
    const flat = JSON.stringify(source);
    await writeFile(join(root, 'ws.json'), flat);
    await seed('nodes/off.json', { schemaVersion: 1, id: 'off', type: 'plugin', data: { content: 'library' } });
    await activateCanvasSqlite(root);
    expect((await readCanvasFull('ws', root)).data?.nodes?.map(node => node.id)).toEqual(['n']);
    expect((await readWorkspaceNode('ws', 'off', root))?.data.content).toBe('library');
    expect(await readFile(join(root, 'ws.json'), 'utf8')).toBe(flat);
  });

  it('preserves a valid old empty layout that omits the nodes field', async () => {
    const raw = await seed('canvas.json', { schemaVersion: 1, transform: { x: 2, y: 3, scale: 1 }, future: 'keep' });
    await activateCanvasSqlite(root);
    expect((await readCanvasFull('ws', root)).data).toMatchObject({
      nodes: [], transform: { x: 2, y: 3, scale: 1 }, future: 'keep',
    });
    expect(await readFile(join(root, 'ws', 'canvas.json'), 'utf8')).toBe(raw);
  });
});
