import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Command } from 'commander';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateLocalCanvasStorage, openLocalStorage } from '@pulse-coder/storage/local';
import { activateLocalConversationStorage } from '@pulse-coder/storage/local-conversations';
import { prepareLegacyCanvasImport, type LegacyCanvas } from '@pulse-coder/storage/canvas';
import { openSqliteStorage } from '@pulse-coder/storage/sqlite';
import * as store from '../store';
import * as nativeBinding from '../native-binding';
import { hasSqliteStorage } from '../sqlite-store';
import { createNode, updateNode, writeNode } from '../nodes';
import { createEdge, deleteEdge } from '../edges';
import { runDoctor } from '../doctor';
import { resolveWorkspaceId } from '../workspace-resolution';
import { registerStatusCommand } from '../../commands/status';
import { registerRestoreCommand } from '../../commands/restore';
import { setActiveFormat } from '../../output';
import type { CanvasSaveData } from '../types';

vi.mock('../runtime-control', () => ({
  probeRuntime: async () => ({ reachable: false, error: 'Not running in this fixture' }),
  runtimeFilePath: () => '/fixture/canvas-runtime.json',
}));

let root: string;
const workspaceId = 'ws-sqlite';

const initialCanvas = (): LegacyCanvas => ({
  nodes: [
    { id: 'z', type: 'text', title: 'Z', x: 10, y: 20, width: 200, height: 120, data: { content: 'Original' } },
    { id: 'a', type: 'text', title: 'A', x: 240, y: 20, width: 200, height: 120, data: { content: 'Second' } },
  ],
  edges: [], transform: { x: 0, y: 0, scale: 1 }, savedAt: '2026-09-19T00:00:00.000Z',
});

async function activate(data = initialCanvas()): Promise<void> {
  const storage = await activateLocalCanvasStorage({
    root,
    loadLegacyWorkspaces: async () => [prepareLegacyCanvasImport(workspaceId, data)],
  });
  await storage.close();
}

function cli(register: (program: Command) => void): Command {
  const program = new Command();
  program.exitOverride();
  program.option('--format <format>', 'Output format', 'json')
    .option('--store-dir <path>', 'Store directory')
    .option('-w, --workspace <id>', 'Workspace id');
  register(program);
  return program;
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'canvas-cli-sqlite-'));
});

afterEach(async () => {
  vi.restoreAllMocks();
  setActiveFormat('text');
  await fs.rm(root, { recursive: true, force: true });
});

describe('activated SQLite CLI storage', () => {
  it.each(['read', 'list', 'status'] as const)('reconciles a stale marker before choosing the %s backend', async operation => {
    await store.saveCanvas(workspaceId, initialCanvas() as CanvasSaveData, root);
    const legacyPath = join(root, workspaceId, 'canvas.json');
    const oldBytes = await fs.readFile(legacyPath, 'utf8');
    await activate();
    const storage = await activateLocalConversationStorage({ root, loadLegacyScopes: async () => [] });
    try {
      await storage.canvas.commit({
        workspaceId, expectedRevision: 1,
        nodes: { put: [{ id: 'z', type: 'text', title: 'SQL authority', data: { content: 'Latest' } }] },
      });
      await storage.canvas.commit({ workspaceId: 'sql-only', expectedRevision: null });
    } finally { await storage.close(); }
    await fs.writeFile(join(root, '__storage__.json'), JSON.stringify({
      schemaVersion: 1, backend: 'sqlite', domains: ['conversations'],
    }));

    if (operation === 'read') expect((await store.loadCanvas(workspaceId, root))?.nodes[0].title).toBe('SQL authority');
    else if (operation === 'list') expect(await store.listWorkspaceIds(root)).toEqual(expect.arrayContaining(['sql-only', workspaceId]));
    else expect(await hasSqliteStorage(root)).toBe(true);
    expect(JSON.parse(await fs.readFile(join(root, '__storage__.json'), 'utf8')).domains).toEqual(['canvas', 'conversations']);
    expect(await fs.readFile(legacyPath, 'utf8')).toBe(oldBytes);
  });

  it('reads and writes the active database while leaving old canvas JSON untouched', async () => {
    await store.saveCanvas(workspaceId, initialCanvas() as CanvasSaveData, root);
    const path = join(root, workspaceId, 'canvas.json');
    const oldBytes = await fs.readFile(path, 'utf8');
    await activate();
    const canvas = await store.loadCanvas(workspaceId, root);
    expect(canvas?.nodes.map(node => node.id)).toEqual(['z', 'a']);
    expect(canvas?.revision).toBe(1);
    canvas!.nodes[0].title = 'From CLI';
    await store.saveCanvas(workspaceId, canvas!, root);
    expect(canvas!.revision).toBe(2);
    expect((await store.loadCanvas(workspaceId, root))?.nodes[0].title).toBe('From CLI');
    expect(await fs.readFile(path, 'utf8')).toBe(oldBytes);
  });

  it('fails closed on a missing database or malformed marker instead of reading old JSON', async () => {
    await store.saveCanvas(workspaceId, initialCanvas() as CanvasSaveData, root);
    await activate();
    const path = join(root, workspaceId, 'canvas.json');
    const oldBytes = await fs.readFile(path, 'utf8');
    await fs.unlink(join(root, '__storage__.sqlite'));
    await expect(store.loadCanvas(workspaceId, root)).rejects.toMatchObject({ code: 'storage_unavailable' });
    await expect(store.listWorkspaceIds(root)).rejects.toMatchObject({ code: 'storage_unavailable' });
    await expect(store.saveCanvas(workspaceId, initialCanvas() as CanvasSaveData, root))
      .rejects.toMatchObject({ code: 'storage_unavailable' });
    expect(await fs.readFile(path, 'utf8')).toBe(oldBytes);
    await fs.writeFile(join(root, '__storage__.json'), '{');
    await expect(store.loadCanvas(workspaceId, root)).rejects.toMatchObject({ code: 'corrupt_data' });
    expect(await fs.readFile(path, 'utf8')).toBe(oldBytes);
  });

  it('refuses an unsupported active database schema instead of falling back to readable legacy JSON', async () => {
    await store.saveCanvas(workspaceId, initialCanvas() as CanvasSaveData, root);
    const path = join(root, workspaceId, 'canvas.json');
    const original = await fs.readFile(path, 'utf8');
    await activate();
    const future = new Database(join(root, '__storage__.sqlite'));
    try { future.pragma('user_version = 999'); } finally { future.close(); }
    await expect(store.loadCanvas(workspaceId, root)).rejects.toMatchObject({ code: 'unsupported_schema' });
    await expect(store.saveCanvas(workspaceId, initialCanvas() as CanvasSaveData, root))
      .rejects.toMatchObject({ code: 'unsupported_schema' });
    expect(await fs.readFile(path, 'utf8')).toBe(original);
  });

  it('rejects stale full snapshots and node/edge mutations without inventing a newer baseline', async () => {
    await activate();
    const stale = await store.loadCanvas(workspaceId, root);
    const external = await openLocalStorage({ root });
    try {
      await external!.canvas.commit({
        workspaceId, expectedRevision: 1,
        nodes: { put: [{ id: 'z', type: 'text', title: 'External', data: { content: 'Kept' } }] },
      });
    } finally {
      await external?.close();
    }
    await expect(store.saveCanvas(workspaceId, stale!, root)).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(stale!.revision).toBe(1);
    await expect(store.commitNodeMutation(workspaceId, { upsert: stale!.nodes[0], expectedRevision: 1 }, root))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(store.commitNodeMutation(workspaceId, {
      upsert: stale!.nodes[0], expectedGeneration: stale!.storageGeneration,
    }, root))
      .rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(store.commitEdgeMutation(workspaceId, { removeId: 'absent', expectedRevision: 1 }, root))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    expect((await store.loadCanvas(workspaceId, root))?.nodes[0].title).toBe('External');
  });

  it('creates and resolves a SQL workspace without a canvas.json file', async () => {
    await activate();
    const result = await store.createWorkspace('SQL only', root);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    const id = result.data.id;
    await expect(fs.access(join(root, id, 'canvas.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await store.loadCanvas(id, root))?.nodes).toEqual([]);
    expect(await store.listWorkspaceIds(root)).toEqual(expect.arrayContaining([workspaceId, id]));
    expect(await resolveWorkspaceId({ explicitId: id, storeDir: root, env: {} }))
      .toEqual({ workspaceId: id, source: 'explicit' });
    await expect(resolveWorkspaceId({ explicitId: 'missing', storeDir: root, env: {} }))
      .rejects.toMatchObject({ code: 'workspace_not_found' });
  });

  it('routes node and edge commands through the original SQL revision and preserves Markdown editing', async () => {
    await activate();
    const created = await createNode(workspaceId, { type: 'file', title: 'Note', data: { content: 'First' } }, root);
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error);
    const id = created.data.nodeId;
    let loaded = await store.loadCanvas(workspaceId, root);
    const note = loaded!.nodes.find(node => node.id === id)!;
    expect(await fs.readFile(String(note.data.filePath), 'utf8')).toBe('First');
    await writeNode(workspaceId, id, 'Second', root);
    expect(await fs.readFile(String(note.data.filePath), 'utf8')).toBe('Second');
    await updateNode(workspaceId, id, { x: 900, title: 'Renamed' }, root);
    const edge = await createEdge(workspaceId, { sourceNodeId: 'z', targetNodeId: id }, root);
    expect(edge.ok).toBe(true);
    if (!edge.ok) throw new Error(edge.error);
    loaded = await store.loadCanvas(workspaceId, root);
    expect(loaded!.nodes.find(node => node.id === id)).toMatchObject({ x: 900, title: 'Renamed' });
    expect(loaded!.edges).toHaveLength(1);
    await deleteEdge(workspaceId, edge.data.edgeId, root);
    expect((await store.loadCanvas(workspaceId, root))?.edges).toEqual([]);
  });

  it('does not overwrite a Markdown file when its original snapshot has become stale', async () => {
    const notePath = join(root, workspaceId, 'notes', 'note.md');
    await fs.mkdir(join(root, workspaceId, 'notes'), { recursive: true });
    await fs.writeFile(notePath, 'External file content');
    const data = initialCanvas();
    data.nodes![0] = { ...data.nodes![0], type: 'file', data: { filePath: notePath, content: 'Cached' } };
    await activate(data);
    const stale = await store.loadCanvas(workspaceId, root);
    const newer = await store.loadCanvas(workspaceId, root);
    newer!.nodes[0].title = 'Newer';
    await store.saveCanvas(workspaceId, newer!, root);
    vi.spyOn(store, 'loadCanvas').mockResolvedValueOnce(stale);
    await expect(writeNode(workspaceId, 'z', 'Rejected write', root)).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await fs.readFile(notePath, 'utf8')).toBe('External file content');
  });

  it('rejects a pre-activation snapshot even when legacy and SQLite revisions both equal one', async () => {
    const notePath = join(root, workspaceId, 'notes', 'upgrade.md');
    await fs.mkdir(join(root, workspaceId, 'notes'), { recursive: true });
    await fs.writeFile(notePath, 'Keep external Markdown');
    const data = initialCanvas() as CanvasSaveData;
    data.nodes[0] = { ...data.nodes[0], type: 'file', data: { filePath: notePath, content: 'Old cache' } };
    await store.saveCanvas(workspaceId, data, root);
    const legacy = await store.loadCanvas(workspaceId, root);
    expect(legacy!.revision).toBe(1);
    expect(legacy!.storageGeneration).toBeUndefined();
    await activate(data as unknown as LegacyCanvas);
    const current = await store.loadCanvas(workspaceId, root);
    expect(current!.revision).toBe(1);
    expect(current!.storageGeneration).toEqual(expect.any(String));
    await expect(store.saveCanvas(workspaceId, legacy!, root)).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(store.commitEdgeMutation(workspaceId, {
      removeId: 'absent', expectedRevision: legacy!.revision, expectedGeneration: legacy!.storageGeneration,
    }, root)).rejects.toMatchObject({ code: 'revision_conflict' });
    vi.spyOn(store, 'loadCanvas').mockResolvedValueOnce(legacy);
    await expect(writeNode(workspaceId, 'z', 'Rejected pre-upgrade write', root))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await fs.readFile(notePath, 'utf8')).toBe('Keep external Markdown');
    expect(legacy!.storageGeneration).toBeUndefined();
    expect((await store.loadCanvas(workspaceId, root))!.revision).toBe(1);
  });

  it('hides a deleted SQL workspace while retaining its directory and legacy source', async () => {
    await store.saveCanvas(workspaceId, initialCanvas() as CanvasSaveData, root);
    await store.saveWorkspaceManifest({ workspaces: [{ id: workspaceId, name: 'Workspace' }], activeId: workspaceId }, root);
    await activate();
    expect(await store.deleteWorkspace(workspaceId, root)).toMatchObject({ ok: true });
    expect(await store.loadCanvas(workspaceId, root)).toBeNull();
    expect(await store.listWorkspaceIds(root)).toEqual([]);
    expect((await store.loadWorkspaceManifest(root)).workspaces).toEqual([]);
    await expect(fs.access(join(root, workspaceId))).resolves.toBeUndefined();
    expect(await fs.readFile(join(root, workspaceId, 'canvas.json'), 'utf8')).toContain('Original');
    expect(await store.listDeletedWorkspaces(root)).toMatchObject([{ workspaceId, metadata: { name: 'Workspace' } }]);
  });

  it('reports SQL integrity and Markdown drift without treating retained node files as current', async () => {
    const notes = join(root, workspaceId, 'notes');
    await fs.mkdir(notes, { recursive: true });
    const notePath = join(notes, 'note.md');
    await fs.writeFile(notePath, 'External Markdown wins');
    const data = initialCanvas();
    data.nodes![0] = { ...data.nodes![0], type: 'file', data: { filePath: notePath, content: 'Old index' } };
    await activate(data);
    await fs.mkdir(join(root, workspaceId, 'nodes'));
    await fs.writeFile(join(root, workspaceId, 'nodes', 'legacy.json'), '{broken old backup');
    const report = await runDoctor(workspaceId, { storeDir: root });
    expect(report.schemaVersion).toBe(3);
    expect(report.findings).toEqual([expect.objectContaining({ kind: 'content_drift', nodeId: 'z', repairable: true })]);
    const repaired = await runDoctor(workspaceId, { storeDir: root, repair: true });
    expect(repaired.findings).toEqual([expect.objectContaining({ kind: 'content_drift', nodeId: 'z', repaired: true })]);
    expect(await fs.readFile(notePath, 'utf8')).toBe('External Markdown wins');
    expect((await store.loadCanvas(workspaceId, root))?.nodes[0].data.content).toBe('External Markdown wins');
  });

  it('reports the SQL backend and inventory through status without a runtime connection', async () => {
    await activate();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await cli(registerStatusCommand).parseAsync([
      'node', 'pulse-canvas', '--store-dir', root, '--workspace', workspaceId, 'status',
    ]);
    const report = JSON.parse(String(log.mock.calls.at(-1)?.[0]));
    expect(report).toMatchObject({ storage: { backend: 'sqlite' }, workspaceCount: 1, resolved: { workspaceId } });
    expect(report.runtime.reachable).toBe(false);
  });

  it('refuses legacy restore against an active database before altering retained JSON', async () => {
    await store.saveCanvas(workspaceId, initialCanvas() as CanvasSaveData, root);
    const canvasPath = join(root, workspaceId, 'canvas.json');
    const oldBytes = await fs.readFile(canvasPath, 'utf8');
    const backup = join(root, 'snapshot.json');
    await fs.writeFile(backup, JSON.stringify(initialCanvas()));
    await activate();
    setActiveFormat('json');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    await expect(cli(registerRestoreCommand).parseAsync([
      'node', 'pulse-canvas', '--store-dir', root, 'restore', 'apply', workspaceId, '--from', backup, '--yes',
    ])).rejects.toThrow('exit');
    expect(JSON.parse(String(errors.mock.calls.at(-1)?.[0]))).toMatchObject({ code: 'unsupported_schema' });
    expect(await fs.readFile(canvasPath, 'utf8')).toBe(oldBytes);
    expect((await store.loadCanvas(workspaceId, root))?.revision).toBe(1);
  });
});

describe('migration fencing for legacy CLI writes', () => {
  it('leaves native resolution lazy for legacy reads, saves, manifests, doctor, restore, and deletion', async () => {
    const resolver = vi.spyOn(nativeBinding, 'resolveSqliteNativeBinding').mockImplementation(() => {
      throw new Error('Native loading is forbidden in this legacy fixture');
    });
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await store.saveCanvas(workspaceId, initialCanvas() as CanvasSaveData, root);
    expect(await store.loadCanvas(workspaceId, root)).not.toBeNull();
    expect(await store.listWorkspaceIds(root)).toContain(workspaceId);
    await store.saveWorkspaceManifest({ workspaces: [{ id: workspaceId, name: 'Legacy' }] }, root);
    expect((await runDoctor(workspaceId, { storeDir: root, repair: true })).findings).toEqual([]);
    const backup = join(root, 'restore.json');
    await fs.writeFile(backup, JSON.stringify(initialCanvas()));
    await cli(registerRestoreCommand).parseAsync([
      'node', 'pulse-canvas', '--store-dir', root, 'restore', 'apply', workspaceId, '--from', backup, '--yes',
    ]);
    expect(await store.deleteWorkspace(workspaceId, root)).toMatchObject({ ok: false, code: 'unsupported_schema' });
    expect(resolver).not.toHaveBeenCalled();
  });

  it('passes the native resolver through the manifest write fence when a database lost its marker', async () => {
    await activate();
    const manifest = { workspaces: [{ id: workspaceId, name: 'Keep' }] };
    await store.saveWorkspaceManifest(manifest, root);
    const oldBytes = await fs.readFile(join(root, '__workspaces__.json'), 'utf8');
    await fs.unlink(join(root, '__storage__.json'));
    const resolver = vi.spyOn(nativeBinding, 'resolveSqliteNativeBinding').mockImplementation(() => {
      throw new Error('Correct packaged native binding is unavailable');
    });
    await expect(store.saveWorkspaceManifest({ workspaces: [] }, root)).rejects.toThrow('Correct packaged native binding is unavailable');
    expect(resolver).toHaveBeenCalledOnce();
    expect(await fs.readFile(join(root, '__workspaces__.json'), 'utf8')).toBe(oldBytes);
  });

  it('keeps Canvas on JSON when only the conversations domain has been activated', async () => {
    const data = initialCanvas() as CanvasSaveData;
    await store.saveCanvas(workspaceId, data, root);
    const conversations = await activateLocalConversationStorage({ root, loadLegacyScopes: async () => [] });
    await conversations.close();
    const loaded = (await store.loadCanvas(workspaceId, root))!;
    expect(loaded.storageGeneration).toBeUndefined();
    loaded.nodes[0].title = 'Legacy Canvas';
    await store.saveCanvas(workspaceId, loaded, root);
    expect(JSON.parse(await fs.readFile(join(root, workspaceId, 'canvas.json'), 'utf8')).nodes[0].title).toBe('Legacy Canvas');
    const storage = await openLocalStorage({ root });
    try { expect(await storage!.canvas.read(workspaceId)).toBeNull(); }
    finally { await storage?.close(); }
  });

  it.each([1, 2])('keeps v%s without revisions authoritative when only an unpublished staging database exists', async version => {
    const canvasPath = join(root, workspaceId, 'canvas.json');
    const legacy = initialCanvas() as CanvasSaveData;
    await fs.mkdir(join(root, workspaceId, 'nodes'), { recursive: true });
    if (version === 2) {
      for (const node of legacy.nodes) {
        await fs.writeFile(join(root, workspaceId, 'nodes', `${node.id}.json`), JSON.stringify({
          schemaVersion: 1, id: node.id, type: node.type, title: node.title, data: node.data,
        }));
      }
    }
    await fs.writeFile(canvasPath, JSON.stringify(version === 1 ? legacy : {
      ...legacy, schemaVersion: 2, nodes: legacy.nodes.map(({ data: _data, ...node }) => node),
    }));
    const staging = await openSqliteStorage({ path: join(root, '__storage__.sqlite') });
    try {
      await staging.localActivation.begin('canvas');
      await staging.canvas.commit({ workspaceId, expectedRevision: null, nodes: { put: [{ id: 'staged-only' }] } });
      const loaded = await store.loadCanvas(workspaceId, root);
      expect(loaded!.nodes.map(node => node.id)).toEqual(['z', 'a']);
      expect(loaded!.revision).toBeUndefined();
      loaded!.nodes[0].title = 'Legacy still writable';
      await store.saveCanvas(workspaceId, loaded!, root);
      expect(loaded!.revision).toBe(1);
      expect((await store.loadCanvas(workspaceId, root))!.nodes[0].title).toBe('Legacy still writable');
      expect((await staging.canvas.read(workspaceId))?.nodes).toEqual([{ id: 'staged-only' }]);
      await expect(fs.access(join(root, '__storage__.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await staging.close();
    }
  });

  it('recovers a missing activation marker from SQL authority and retains newer CLI edits', async () => {
    await store.saveCanvas(workspaceId, initialCanvas() as CanvasSaveData, root);
    await activate();
    const current = (await store.loadCanvas(workspaceId, root))!;
    current.nodes[0].title = 'Committed after upgrade';
    await store.saveCanvas(workspaceId, current, root);
    await fs.unlink(join(root, '__storage__.json'));
    expect((await store.loadCanvas(workspaceId, root))!.nodes[0].title).toBe('Committed after upgrade');
    expect(JSON.parse(await fs.readFile(join(root, '__storage__.json'), 'utf8')).domains).toEqual(['canvas']);
  });

  it('blocks legacy canvas and manifest writes while activation owns the migration lock', async () => {
    await fs.mkdir(join(root, '__storage_migration__.lock'));
    const data = initialCanvas() as CanvasSaveData;
    await expect(store.saveCanvas(workspaceId, data, root)).rejects.toMatchObject({ code: 'storage_busy' });
    await expect(store.saveWorkspaceManifest({ workspaces: [] }, root)).rejects.toMatchObject({ code: 'storage_busy' });
    expect(data.revision).toBeUndefined();
    await expect(fs.access(join(root, workspaceId, 'canvas.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps manifest-only writes available after SQLite activation', async () => {
    await activate();
    await store.saveWorkspaceManifest({ workspaces: [{ id: workspaceId, name: 'Renamed' }], activeId: workspaceId }, root);
    expect(await store.loadWorkspaceManifest(root)).toMatchObject({ activeId: workspaceId });
    expect((await store.loadCanvas(workspaceId, root))?.revision).toBe(1);
  });
});
