import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasRepository, EntityRecord, PulseStorage } from './contracts.js';
import { RevisionConflictError } from './errors.js';
import {
  createCanvasCompatibilityStore,
  prepareLegacyCanvasImport,
  type LegacyCanvas,
} from './canvas-compat.js';
import { openSqliteStorage } from './sqlite/index.js';

let directory: string;
let storage: PulseStorage;
let compat: ReturnType<typeof createCanvasCompatibilityStore>;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'pulse-canvas-compat-'));
  storage = await openSqliteStorage({ path: join(directory, 'store.sqlite') });
  compat = createCanvasCompatibilityStore(storage.canvas);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await storage?.close();
  await rm(directory, { recursive: true, force: true });
});

const canvas = (): LegacyCanvas => ({
  nodes: [
    { id: 'z', type: 'plugin', title: 'Z', x: 10, y: 20, data: { payload: { nested: [1, 'value', true] } } },
    { id: 'a', type: 'text', title: 'A', x: 30, y: 40, data: { content: 'Inline text' } },
  ],
  edges: [{ id: 'z-edge', source: { nodeId: 'z' }, target: { nodeId: 'a' } }, { id: 'a-edge' }],
  transform: { x: 5, y: -8, scale: 0.75 },
  savedAt: '2026-09-19T00:00:00.000Z',
});

describe('canvas compatibility store', () => {
  it('round-trips legacy fields, unknown payloads and draw order through separate collections', async () => {
    const input = canvas();
    input.nodes![0].properties = { tags: ['source'], importance: 2 };
    input.nodes![0].links = [{ relation: 'related', target: { nodeId: 'a' } }];
    input.nodes![0].futureLayoutField = { enabled: true };
    const receipt = await compat.writeCanvas('work', input);
    expect(input.revision).toBe(receipt.revision);
    expect(await compat.readCanvas('work')).toMatchObject(input);
    const loaded = await compat.readCanvas('work');
    expect(loaded?.nodes?.map(node => node.id)).toEqual(['z', 'a']);
    expect(loaded?.edges?.map(edge => (edge as { id: string }).id)).toEqual(['z-edge', 'a-edge']);
    expect(loaded).not.toHaveProperty('__canvasCompatibility');
    const stored = await storage.canvas.read('work');
    expect(stored?.placements[0]).not.toHaveProperty('data');
    expect(stored?.nodes.find(node => node.id === 'z')).toMatchObject({
      properties: input.nodes![0].properties, links: input.nodes![0].links,
      data: input.nodes![0].data,
    });

    loaded!.nodes!.reverse();
    loaded!.edges!.reverse();
    const commit = vi.spyOn(storage.canvas, 'commit');
    await compat.writeCanvas('work', loaded!);
    expect(commit.mock.calls[0][0]).toMatchObject({ nodes: {}, placements: {}, edges: {} });
    expect((await compat.readCanvas('work'))?.nodes?.map(node => node.id)).toEqual(['a', 'z']);
  });

  it('rejects an old snapshot or missing revision without overwriting a newer atom', async () => {
    await compat.writeCanvas('work', canvas());
    const old = await compat.readCanvas('work');
    await compat.mutateNode('work', 'z', record => ({
      record: { ...record!, title: 'Updated elsewhere' }, result: undefined,
    }));
    old!.nodes![0].x = 500;
    await expect(compat.writeCanvas('work', old!)).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(compat.writeCanvas('work', canvas())).rejects.toMatchObject({ code: 'revision_conflict' });
    expect((await compat.readNode('work', 'z'))?.title).toBe('Updated elsewhere');
    expect((await compat.readCanvas('work'))?.nodes?.[0].x).toBe(10);
    await expect(compat.writeCanvas('missing', { revision: 1, nodes: [] }))
      .rejects.toMatchObject({ code: 'revision_conflict', actualRevision: null });
  });

  it('also rejects a writer when the repository changes after the compatibility read', async () => {
    await compat.writeCanvas('work', canvas());
    const input = await compat.readCanvas('work');
    const repository: CanvasRepository = {
      ...storage.canvas,
      commit: async mutation => {
        await storage.canvas.commit({
          workspaceId: 'work', expectedRevision: mutation.expectedRevision,
          nodes: { put: [{ id: 'concurrent', data: { content: 'Keep me' } }] },
        });
        return storage.canvas.commit(mutation);
      },
    };
    const racing = createCanvasCompatibilityStore(repository);
    await expect(racing.writeCanvas('work', input!)).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(input!.revision).toBe(1);
    expect(await compat.readNode('work', 'concurrent')).not.toBeNull();
  });

  it('preserves off-canvas atoms when a placement disappears and only removes them explicitly', async () => {
    await compat.writeCanvas('work', canvas());
    const input = await compat.readCanvas('work');
    input!.nodes = input!.nodes!.filter(node => node.id !== 'z');
    await compat.writeCanvas('work', input!);
    expect((await compat.readCanvas('work'))?.nodes?.map(node => node.id)).toEqual(['a']);
    expect(await compat.readNode('work', 'z')).not.toBeNull();
    await compat.writeCanvas('work', input!, { removedNodeIds: ['z'] });
    expect(await compat.readNode('work', 'z')).toBeNull();
    expect(await compat.readNode('work', 'a')).not.toBeNull();
  });

  it('keeps atom attributes omitted by a legacy writer and only puts the changed placement', async () => {
    const input = canvas();
    input.nodes![0].properties = { tags: ['kept'] };
    input.nodes![0].links = [{ relation: 'source', target: { nodeId: 'a' } }];
    await compat.writeCanvas('work', input);
    const loaded = await compat.readCanvas('work');
    delete loaded!.nodes![0].properties;
    delete loaded!.nodes![0].links;
    loaded!.nodes![0].x = 99;
    delete loaded!.edges;
    const commit = vi.spyOn(storage.canvas, 'commit');
    await compat.writeCanvas('work', loaded!);
    expect(commit.mock.calls[0][0].nodes).toEqual({});
    expect(commit.mock.calls[0][0].placements?.put?.map(node => node.id)).toEqual(['z']);
    expect(commit.mock.calls[0][0].edges).toEqual({});
    expect(await compat.readNode('work', 'z')).toMatchObject({
      properties: { tags: ['kept'] }, links: input.nodes![0].links,
    });
    expect((await compat.readCanvas('work'))?.edges).toHaveLength(2);
  });

  it('requires an explicit empty-canvas overwrite and preserves atoms on an intentional clear', async () => {
    await compat.writeCanvas('work', canvas());
    const input = await compat.readCanvas('work');
    input!.nodes = [];
    input!.edges = [];
    await expect(compat.writeCanvas('work', input!)).rejects.toMatchObject({ code: 'invalid_argument' });
    expect((await storage.canvas.read('work'))?.revision).toBe(1);
    await compat.writeCanvas('work', input!, { allowEmpty: true });
    expect(await compat.readCanvas('work')).toMatchObject({ nodes: [], edges: [], revision: 2 });
    expect(await compat.listNodes('work')).toHaveLength(2);
  });

  it('keeps layout-only references intact without manufacturing backing atoms', async () => {
    const reference = {
      id: 'reference', type: 'reference', ref: { kind: 'workspace-node', workspaceId: 'other', nodeId: 'target' },
      x: 3, data: { preview: 'Preview' },
    };
    await compat.writeCanvas('work', { nodes: [reference] });
    expect(await compat.readNode('work', 'reference')).toBeNull();
    expect(await compat.readCanvas('work')).toMatchObject({ nodes: [reference] });
    expect((await storage.canvas.read('work'))?.nodes).toEqual([]);
  });

  it('imports all atoms, preserving unknown atom fields while composed legacy data wins', async () => {
    const atoms: EntityRecord[] = [
      { id: 'z', type: 'plugin', data: { content: 'older' }, unknownAtomField: { keep: true } },
      { id: 'off-canvas', data: { content: 'Library only' } },
    ];
    const imported = prepareLegacyCanvasImport('work', canvas(), atoms);
    expect(imported.nodes.find(node => node.id === 'z')).toMatchObject({
      unknownAtomField: { keep: true }, data: canvas().nodes![0].data,
    });
    expect(imported.nodes.find(node => node.id === 'off-canvas')).toEqual(atoms[1]);
    await storage.canvas.commit({
      workspaceId: imported.workspaceId, expectedRevision: null, metadata: imported.metadata,
      nodes: { put: imported.nodes }, placements: { put: imported.placements }, edges: { put: imported.edges },
    });
    expect((await compat.readCanvas('work'))?.nodes?.map(node => node.id)).toEqual(['z', 'a']);
    expect(await compat.listNodes('work')).toHaveLength(3);
    expect(atoms[0].data).toEqual({ content: 'older' });
  });

  it('replays an async pure atom mutation against a fresh revision without holding a transaction', async () => {
    await compat.mutateNode('work', 'counter', () => ({ record: { id: 'counter', value: 0 }, result: undefined }));
    expect((await storage.canvas.read('work'))?.metadata).toEqual({});
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const observed: number[] = [];
    const mutation = compat.mutateNode('work', 'counter', async record => {
      observed.push(Number(record!.value));
      if (observed.length === 1) await gate;
      return { record: { ...record!, value: Number(record!.value) + 1 }, result: Number(record!.value) + 1 };
    });
    await vi.waitFor(() => expect(observed).toEqual([0]));
    await storage.canvas.commit({
      workspaceId: 'work', expectedRevision: 1, nodes: { put: [{ id: 'counter', value: 10 }] },
    });
    release();
    expect(await mutation).toBe(11);
    expect(observed).toEqual([0, 10]);
    expect((await storage.canvas.read('work'))?.revision).toBe(3);
    expect(await compat.readNode('work', 'counter')).toEqual({ id: 'counter', value: 11 });
  });

  it('bounds pure-mutation conflict retries and does not change a node id', async () => {
    const commit = vi.fn(async () => { throw new RevisionConflictError('work', null, 1); });
    const conflicting = createCanvasCompatibilityStore({ ...storage.canvas, commit });
    const update = vi.fn(() => ({ record: { id: 'node' }, result: undefined }));
    await expect(conflicting.mutateNode('work', 'node', update)).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(commit).toHaveBeenCalledTimes(3);
    expect(update).toHaveBeenCalledTimes(3);
    await expect(compat.mutateNode('work', 'node', () => ({ record: { id: 'wrong' }, result: undefined })))
      .rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await compat.readCanvas('work')).toBeNull();
  });

  it('deletes only the requested atom and reads every page of the atom inventory', async () => {
    await storage.canvas.commit({
      workspaceId: 'work', expectedRevision: null,
      nodes: { put: Array.from({ length: 501 }, (_, index) => ({ id: `node-${index}` })) },
      placements: { put: [{ id: 'node-0', x: 1 }] },
    });
    expect(await compat.listNodes('work')).toHaveLength(501);
    await compat.deleteNode('work', 'node-0');
    expect(await compat.readNode('work', 'node-0')).toBeNull();
    expect((await storage.canvas.read('work'))?.placements).toEqual([{ id: 'node-0', x: 1 }]);
    expect((await storage.canvas.read('work'))?.revision).toBe(2);
    await compat.deleteNode('missing', 'absent');
  });

  it('strips undefined compatibility fields while rejecting cycles, invalid values and duplicates', async () => {
    const input: LegacyCanvas = { nodes: [{ id: 'node', title: undefined, data: { optional: undefined } }] };
    await compat.writeCanvas('work', input);
    expect(await compat.readNode('work', 'node')).toEqual({ id: 'node', schemaVersion: 1, data: {} });
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [cycle, { callback: () => undefined }, { amount: NaN }]) {
      await expect(compat.writeCanvas('bad', { nodes: [{ id: 'node', data: value }] }))
        .rejects.toMatchObject({ code: 'invalid_argument' });
    }
    await expect(compat.writeCanvas('bad', { nodes: [{ id: 'same' }, { id: 'same' }] }))
      .rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await compat.readCanvas('bad')).toBeNull();
  });
});
