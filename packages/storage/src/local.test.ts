import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PulseStorage } from './contracts.js';
import {
  activateLocalCanvasStorage,
  assertLegacyCanvasWritable,
  openLocalStorage,
  readLocalStorageStatus,
  withLegacyCanvasWrite,
  type LegacyCanvasWorkspace,
} from './local.js';
import * as sqlite from './sqlite/index.js';

let root: string;
let opened: PulseStorage[];
const marker = { schemaVersion: 1, backend: 'sqlite', domains: ['canvas'] };
const workspace = (workspaceId: string): LegacyCanvasWorkspace => ({
  workspaceId,
  metadata: { title: workspaceId, plugin: { custom: true } },
  nodes: [{ id: 'node-a', content: 'body', plugin: { unknown: ['中文', null] } }],
  placements: [{ id: 'placement-a', nodeId: 'node-a', x: 12 }],
  edges: [{ id: 'edge-a', from: 'placement-a', to: 'placement-a' }],
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pulse-local-storage-'));
  opened = [];
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const storage of opened) await storage.close();
  await rm(root, { recursive: true, force: true });
});

async function activate(snapshots: LegacyCanvasWorkspace[]): Promise<PulseStorage> {
  const storage = await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: async () => snapshots });
  opened.push(storage);
  return storage;
}

describe('local backend activation', () => {
  it('recovers a migration lock left by an exited process without deleting the evidence', async () => {
    const lock = join(root, '__storage_migration__.lock');
    const token = randomUUID();
    execFileSync(process.execPath, ['-e', `
      const fs = require('node:fs');
      const path = require('node:path');
      fs.mkdirSync(process.argv[1]);
      fs.writeFileSync(path.join(process.argv[1], 'owner.json'), JSON.stringify({ pid: process.pid, token: process.argv[2] }));
    `, lock, token]);
    const storage = await activate([workspace('ws')]);
    expect(await storage.canvas.read('ws')).not.toBeNull();
    expect(await readLocalStorageStatus(root)).toEqual(marker);
    expect((await readdir(root)).some(name => name === `__storage_migration__.lock.recovered-${token}`)).toBe(true);
  });

  it('never expires a lock belonging to a live process', async () => {
    const lock = join(root, '__storage_migration__.lock');
    await mkdir(lock);
    await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, token: randomUUID() }));
    await expect(activate([])).rejects.toMatchObject({ code: 'storage_busy' });
    expect(await readLocalStorageStatus(root)).toBeNull();
    expect((await stat(lock)).isDirectory()).toBe(true);
  });

  it('leaves an inactive root untouched and does not create a database', async () => {
    const missingRoot = join(root, 'not-created');
    expect(await readLocalStorageStatus(missingRoot)).toBeNull();
    expect(await openLocalStorage({ root: missingRoot })).toBeNull();
    await expect(stat(missingRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(root)).toEqual([]);
  });

  it('imports Canvas structure with a recovery snapshot while preserving legacy files and Markdown', async () => {
    const snapshots = [workspace('workspace-a')];
    const legacyText = JSON.stringify(snapshots);
    await writeFile(join(root, 'legacy-canvas.json'), legacyText);
    await mkdir(join(root, 'notes'));
    await writeFile(join(root, 'notes', 'source.md'), '# Authoritative Markdown\n');
    await writeFile(join(root, 'notes', 'attachment.bin'), Buffer.from([0, 255, 12]));
    const storage = await activate(snapshots);

    expect(await readLocalStorageStatus(root)).toEqual(marker);
    expect(JSON.parse(await readFile(join(root, '__storage__.json'), 'utf8'))).toEqual(marker);
    expect(await storage.canvas.read('workspace-a')).toEqual({ ...snapshots[0], revision: 1, generation: storage.generation });
    expect(await readFile(join(root, 'legacy-canvas.json'), 'utf8')).toBe(legacyText);
    expect(await readFile(join(root, 'notes', 'source.md'), 'utf8')).toBe('# Authoritative Markdown\n');
    expect(await readFile(join(root, 'notes', 'attachment.bin'))).toEqual(Buffer.from([0, 255, 12]));
    const backups = await readdir(join(root, '__storage-backup__'));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/^canvas-.*\.json$/);
    expect(JSON.parse(await readFile(join(root, '__storage-backup__', backups[0]), 'utf8')))
      .toMatchObject({ schemaVersion: 1, domain: 'canvas', snapshots });
    await expect(stat(join(root, '__storage_migration__.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await readdir(root)).some(file => file.endsWith('.tmp'))).toBe(false);
  });

  it('opens independent connections after activation and never imports edited legacy JSON again', async () => {
    const first = await activate([workspace('workspace-a')]);
    await first.canvas.commit({
      workspaceId: 'workspace-a', expectedRevision: 1, metadata: { title: 'SQLite is authoritative' },
      nodes: { put: [{ id: 'node-a', content: 'new database content' }] },
    });
    const legacyPath = join(root, 'legacy-canvas.json');
    await writeFile(legacyPath, JSON.stringify([workspace('old-workspace')]));
    const loadLegacyWorkspaces = vi.fn(async () => JSON.parse(await readFile(legacyPath, 'utf8')));
    const second = await activateLocalCanvasStorage({ root, loadLegacyWorkspaces });
    opened.push(second);
    const third = await openLocalStorage({ root });
    expect(third).not.toBeNull();
    opened.push(third!);
    expect(first).not.toBe(second);
    expect(second).not.toBe(third);
    expect(loadLegacyWorkspaces).not.toHaveBeenCalled();
    expect(await second.canvas.read('old-workspace')).toBeNull();
    expect(await third!.canvas.readNode('workspace-a', 'node-a')).toEqual({ id: 'node-a', content: 'new database content' });
    await second.close();
    expect(await first.canvas.read('workspace-a')).toMatchObject({ metadata: { title: 'SQLite is authoritative' } });
    expect(await readdir(join(root, '__storage-backup__'))).toHaveLength(1);
  });

  it('reconciles a partial staging import from fresh legacy snapshots before publishing a marker', async () => {
    const broken = workspace('broken');
    broken.nodes.push({ ...broken.nodes[0] });
    const initial = [workspace('stale-workspace'), workspace('workspace-a'), broken];
    await expect(activate(initial)).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await readLocalStorageStatus(root)).toBeNull();
    expect(await openLocalStorage({ root })).toBeNull();
    await expect(stat(join(root, '__storage_migration__.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    const staging = await sqlite.openSqliteStorage({ path: join(root, '__storage__.sqlite') });
    opened.push(staging);
    expect(await staging.canvas.read('stale-workspace')).not.toBeNull();
    expect(await staging.canvas.read('workspace-a')).not.toBeNull();
    await staging.close();

    const updated: LegacyCanvasWorkspace = {
      workspaceId: 'workspace-a', metadata: { title: 'Updated source' },
      nodes: [{ id: 'new-node', content: 'fresh' }], placements: [], edges: [],
    };
    const storage = await activate([updated]);
    expect(await readLocalStorageStatus(root)).toEqual(marker);
    expect(await storage.canvas.read('stale-workspace')).toBeNull();
    expect(await storage.canvas.read('broken')).toBeNull();
    expect(await storage.canvas.read('workspace-a')).toEqual({ ...updated, revision: 2, generation: storage.generation });
    const backups = await readdir(join(root, '__storage-backup__'));
    expect(backups).toHaveLength(2);
    const copies = await Promise.all(backups.map(async file => (
      JSON.parse(await readFile(join(root, '__storage-backup__', file), 'utf8')).snapshots
    )));
    expect(copies).toContainEqual(initial);
    expect(copies).toContainEqual([updated]);
  });

  it('releases its lock if the legacy reader rejects', async () => {
    await expect(activateLocalCanvasStorage({
      root, loadLegacyWorkspaces: async () => { throw new Error('source unavailable'); },
    })).rejects.toMatchObject({ code: 'storage_unavailable' });
    expect(await readLocalStorageStatus(root)).toBeNull();
    await expect(stat(join(root, '__storage_migration__.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    await activate([]);
    expect(await readLocalStorageStatus(root)).toEqual(marker);
  });

  it('keeps the marker unpublished when the legacy source changes during import', async () => {
    const original = workspace('workspace-a');
    const changed = { ...workspace('workspace-a'), metadata: { title: 'Changed by an older process' } };
    const loadLegacyWorkspaces = vi.fn()
      .mockResolvedValueOnce([original])
      .mockResolvedValueOnce([changed]);
    await expect(activateLocalCanvasStorage({ root, loadLegacyWorkspaces }))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    expect(loadLegacyWorkspaces).toHaveBeenCalledTimes(2);
    expect(await readLocalStorageStatus(root)).toBeNull();
    await expect(stat(join(root, '__storage_migration__.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    const storage = await activate([changed]);
    expect(await storage.canvas.read('workspace-a')).toMatchObject({ metadata: changed.metadata });
  });

  it('rejects overlapping activations while holding the lock through import', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const loadLegacyWorkspaces = vi.fn(async () => { await gate; return [workspace('workspace-a')]; });
    const pending = activateLocalCanvasStorage({ root, loadLegacyWorkspaces });
    await vi.waitFor(() => expect(loadLegacyWorkspaces).toHaveBeenCalledOnce());
    const secondReader = vi.fn(async () => []);
    try {
      await expect(activateLocalCanvasStorage({ root, loadLegacyWorkspaces: secondReader }))
        .rejects.toMatchObject({ code: 'storage_busy' });
      expect(secondReader).not.toHaveBeenCalled();
      const write = vi.fn(async () => undefined);
      await expect(withLegacyCanvasWrite(root, write)).rejects.toMatchObject({ code: 'storage_busy' });
      await expect(withLegacyCanvasWrite(root, write, { allowActive: true }))
        .rejects.toMatchObject({ code: 'storage_busy' });
      await expect(assertLegacyCanvasWritable(root)).rejects.toMatchObject({ code: 'storage_busy' });
      expect(write).not.toHaveBeenCalled();
    } finally {
      release();
      opened.push(await pending);
    }
    await expect(stat(join(root, '__storage_migration__.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not remove a pre-existing migration lock that may belong to another process', async () => {
    const lockPath = join(root, '__storage_migration__.lock');
    await mkdir(lockPath);
    const loadLegacyWorkspaces = vi.fn(async () => []);
    await expect(activateLocalCanvasStorage({ root, loadLegacyWorkspaces }))
      .rejects.toMatchObject({ code: 'storage_busy', message: expect.stringContaining('manual lock recovery') });
    expect((await stat(lockPath)).isDirectory()).toBe(true);
    expect(loadLegacyWorkspaces).not.toHaveBeenCalled();
  });

  it.each([
    ['not-json', 'corrupt_data'],
    [JSON.stringify({ ...marker, schemaVersion: 2 }), 'unsupported_schema'],
    [JSON.stringify({ ...marker, backend: 'unknown' }), 'unsupported_schema'],
    [JSON.stringify({ ...marker, domains: ['canvas', 'unknown'] }), 'unsupported_schema'],
  ])('rejects invalid or unknown markers without falling back: %s', async (text, code) => {
    await writeFile(join(root, '__storage__.json'), text);
    const loadLegacyWorkspaces = vi.fn(async () => []);
    await expect(readLocalStorageStatus(root)).rejects.toMatchObject({ code });
    await expect(openLocalStorage({ root })).rejects.toMatchObject({ code });
    await expect(activateLocalCanvasStorage({ root, loadLegacyWorkspaces })).rejects.toMatchObject({ code });
    expect(loadLegacyWorkspaces).not.toHaveBeenCalled();
    await expect(stat(join(root, '__storage__.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(['missing', 'empty', 'corrupt'])('fails closed when an active database is %s', async state => {
    await writeFile(join(root, '__storage__.json'), JSON.stringify(marker));
    if (state !== 'missing') await writeFile(join(root, '__storage__.sqlite'), state === 'empty' ? '' : 'not a database');
    const loadLegacyWorkspaces = vi.fn(async () => [workspace('legacy')]);
    await expect(openLocalStorage({ root })).rejects.toMatchObject({
      code: state === 'corrupt' ? 'corrupt_data' : 'storage_unavailable',
    });
    await expect(activateLocalCanvasStorage({ root, loadLegacyWorkspaces })).rejects.toBeInstanceOf(Error);
    expect(loadLegacyWorkspaces).not.toHaveBeenCalled();
    expect(await readLocalStorageStatus(root)).toEqual(marker);
    if (state === 'missing') await expect(stat(join(root, '__storage__.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not publish the activation marker if imported storage fails integrity checks', async () => {
    const openDatabase = sqlite.openSqliteStorage;
    const close = vi.fn<[], Promise<void>>();
    vi.spyOn(sqlite, 'openSqliteStorage').mockImplementationOnce(async options => {
      const storage = await openDatabase(options);
      close.mockImplementation(() => storage.close());
      return { ...storage, close, checkIntegrity: async () => ({ ok: false, issues: ['fixture corruption'] }) };
    });
    await expect(activate([workspace('workspace-a')])).rejects.toMatchObject({ code: 'corrupt_data' });
    expect(await readLocalStorageStatus(root)).toBeNull();
    expect(close).toHaveBeenCalledOnce();
    await expect(stat(join(root, '__storage_migration__.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('legacy Canvas write gate', () => {
  it('serializes separate writers in the same process and continues after a rejected write', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const events: string[] = [];
    const first = withLegacyCanvasWrite(root, async () => {
      events.push('first');
      await gate;
      throw new Error('write failed');
    });
    const rejected = expect(first).rejects.toThrow('write failed');
    const second = withLegacyCanvasWrite(root, async () => { events.push('second'); });
    await vi.waitFor(() => expect(events).toEqual(['first']));
    release();
    await rejected;
    await second;
    expect(events).toEqual(['first', 'second']);
  });

  it('shares one lock across nested writes and releases it after the outer operation', async () => {
    const result = await withLegacyCanvasWrite(root, async () => {
      expect((await stat(join(root, '__storage_migration__.lock'))).isDirectory()).toBe(true);
      await assertLegacyCanvasWritable(root);
      const nested = await withLegacyCanvasWrite(root, async () => 'written');
      expect(nested).toBe('written');
      expect((await stat(join(root, '__storage_migration__.lock'))).isDirectory()).toBe(true);
      const loadLegacyWorkspaces = vi.fn(async () => []);
      await expect(activateLocalCanvasStorage({ root, loadLegacyWorkspaces }))
        .rejects.toMatchObject({ code: 'storage_busy' });
      expect(loadLegacyWorkspaces).not.toHaveBeenCalled();
      return 7;
    });
    expect(result).toBe(7);
    await expect(stat(join(root, '__storage_migration__.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    await assertLegacyCanvasWritable(root);
  });

  it('releases the write lock when the operation rejects', async () => {
    await expect(withLegacyCanvasWrite(root, async () => { throw new Error('write failed'); }))
      .rejects.toThrow('write failed');
    await expect(stat(join(root, '__storage_migration__.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await withLegacyCanvasWrite(root, async () => 'retry')).toBe('retry');
  });

  it('rejects stale legacy writers after activation without invoking their operations', async () => {
    await activate([]);
    const write = vi.fn(async () => undefined);
    await expect(withLegacyCanvasWrite(root, write)).rejects.toMatchObject({ code: 'storage_unavailable' });
    await expect(assertLegacyCanvasWritable(root)).rejects.toMatchObject({ code: 'storage_unavailable' });
    expect(write).not.toHaveBeenCalled();
    await expect(stat(join(root, '__storage_migration__.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('allows manifest-only writes with an active marker without opening SQLite or authorizing nested Canvas writes', async () => {
    await writeFile(join(root, '__storage__.json'), JSON.stringify(marker));
    const nestedCanvasWrite = vi.fn(async () => undefined);
    await withLegacyCanvasWrite(root, async () => {
      await writeFile(join(root, 'manifest.json'), '{}');
      await expect(withLegacyCanvasWrite(root, nestedCanvasWrite))
        .rejects.toMatchObject({ code: 'storage_unavailable' });
      expect(await withLegacyCanvasWrite(root, async () => 'manifest nested', { allowActive: true }))
        .toBe('manifest nested');
    }, { allowActive: true });
    expect(nestedCanvasWrite).not.toHaveBeenCalled();
    expect(await readFile(join(root, 'manifest.json'), 'utf8')).toBe('{}');
    await expect(stat(join(root, '__storage__.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not let a detached descendant bypass a later writer after its original lock was released', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let detached!: Promise<void>;
    const write = vi.fn(async () => undefined);
    await withLegacyCanvasWrite(root, async () => {
      detached = gate.then(() => withLegacyCanvasWrite(root, write));
    });
    let releaseCurrent!: () => void;
    const currentGate = new Promise<void>(resolve => { releaseCurrent = resolve; });
    let currentStarted = false;
    const current = withLegacyCanvasWrite(root, async () => {
      currentStarted = true;
      await currentGate;
    });
    await vi.waitFor(() => expect(currentStarted).toBe(true));
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
    releaseCurrent();
    await current;
    await detached;
    expect(write).toHaveBeenCalledOnce();
  });
});
