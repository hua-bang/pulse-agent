import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceBundleImport, TrashWorkspaceInput } from '../workspace-contracts.js';
import { prepareLocalFileWrite, recoverLocalFileWrites } from '../local-files.js';
import { openSqliteStorage, type SqliteStorage } from './index.js';

let root: string;
let path: string;
let storage: SqliteStorage;
const bundle = (workspaceId = 'ws'): WorkspaceBundleImport => ({
  canvas: {
    workspaceId, metadata: { unknown: { keep: true } },
    nodes: [{ id: 'visible', data: { body: 'Keep body' } }, { id: 'off-canvas', custom: 42 }],
    placements: [{ id: 'visible', x: 20 }], edges: [{ id: 'edge', source: 'visible', target: 'visible' }],
  },
  currentSessionId: 'current',
  conversations: [
    { sessionId: 'current', metadata: { title: 'Chat', pinned: true }, messages: [{ id: 'm', content: 'Keep history', extra: true }] },
    { sessionId: 'archive', metadata: {}, messages: [{ id: 'a', content: 'Archive' }] },
  ],
});
async function deletion(workspaceId = 'ws'): Promise<TrashWorkspaceInput> {
  const current = (await storage.workspaces.readBundle(workspaceId))!;
  return {
    workspaceId, expectedCanvasRevision: current.canvas.revision, generation: storage.generation,
    expectedConversations: current.conversationState, metadata: { id: workspaceId, name: 'Original name', folderId: 'folder' },
  };
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pulse-workspace-trash-'));
  path = join(root, 'store.sqlite');
  storage = await openSqliteStorage({ path });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await storage.close();
  await rm(root, { recursive: true, force: true });
});

describe('workspace trash lifecycle', () => {
  it('hides all ordinary reads, preserves complete content and pointer, and restores fresh revisions', async () => {
    await storage.workspaces.importBundle(bundle());
    const before = (await storage.workspaces.readBundle('ws'))!;
    const cursor = await storage.changes.latestCursor();
    const trashed = await storage.workspaces.trashBundle(await deletion());
    expect(trashed).toMatchObject({ workspaceId: 'ws', revision: 2, generation: storage.generation, metadata: { name: 'Original name' } });
    expect(Number.isFinite(Date.parse(trashed.deletedAt))).toBe(true);
    expect(await storage.workspaces.getTrashed('ws')).toEqual(trashed);
    expect((await storage.workspaces.listTrashed()).items).toEqual([trashed]);
    expect(await storage.workspaces.readBundle('ws')).toBeNull();
    expect(await storage.canvas.read('ws')).toBeNull();
    expect(await storage.canvas.readNode('ws', 'visible')).toBeNull();
    expect((await storage.canvas.listNodes('ws')).items).toEqual([]);
    expect((await storage.canvas.list()).items).toEqual([]);
    expect(await storage.conversations.read('ws', 'current')).toBeNull();
    expect((await storage.conversations.list('ws')).items).toEqual([]);
    expect(await storage.conversationScopes.read('ws')).toBeNull();
    expect((await storage.conversationScopes.list()).items).toEqual([]);
    const removed = (await storage.changes.read({ cursor })).items;
    expect(removed).toHaveLength(4);
    expect(removed.every(change => change.kind === 'removed' && change.revision === 2)).toBe(true);
    expect(removed.find(change => change.domain === 'canvas')?.changedIds).toEqual(expect.arrayContaining(['visible', 'off-canvas', 'edge']));

    await storage.close();
    storage = await openSqliteStorage({ path });
    expect(await storage.workspaces.getTrashed('ws')).toEqual(trashed);

    const receipt = await storage.workspaces.restoreBundle('ws', trashed.revision, trashed.generation);
    expect(receipt.revision).toBe(3);
    const restored = (await storage.workspaces.readBundle('ws'))!;
    expect(restored.canvas).toEqual({ ...before.canvas, revision: 3 });
    expect(restored.conversationScope).toEqual({ ...before.conversationScope, revision: 3 });
    expect(restored.conversations).toEqual(before.conversations.map(session => ({ ...session, revision: 3 })));
    expect(await storage.workspaces.getTrashed('ws')).toBeNull();
    expect((await storage.workspaces.listTrashed()).items).toEqual([]);
    expect((await storage.changes.read({ cursor: removed.at(-1)!.cursor })).items.every(change => change.kind === 'updated')).toBe(true);
    expect(await storage.checkIntegrity()).toEqual({ ok: true, issues: [] });
  });

  it('keeps a workspace with no conversation scope deleted until explicit restore', async () => {
    await storage.workspaces.importBundle({ canvas: bundle().canvas });
    const trashed = await storage.workspaces.trashBundle(await deletion());
    await expect(storage.conversationScopes.commit({
      scopeId: 'ws', expectedRevision: null, currentSessionId: 'new',
      conversations: [{ sessionId: 'new', expectedRevision: null }],
    })).rejects.toMatchObject({ code: 'not_found' });
    await storage.workspaces.restoreBundle('ws', trashed.revision, trashed.generation);
    expect((await storage.workspaces.readBundle('ws'))?.conversationScope).toBeNull();
    expect((await storage.workspaces.readBundle('ws'))?.conversations).toEqual([]);
  });

  it('rejects mutations and implicit recreation while trashed, and rejects old snapshots after restore', async () => {
    await storage.workspaces.importBundle(bundle());
    const input = await deletion();
    const trashed = await storage.workspaces.trashBundle(input);
    const cursor = await storage.changes.latestCursor();
    const writes = [
      () => storage.canvas.commit({ workspaceId: 'ws', expectedRevision: 1 }),
      () => storage.canvas.commit({ workspaceId: 'ws', expectedRevision: null }),
      () => storage.canvas.remove('ws', trashed.revision),
      () => storage.conversations.commit({ scopeId: 'ws', sessionId: 'current', expectedRevision: 1, appendMessages: [{ id: 'late' }] }),
      () => storage.conversations.commit({ scopeId: 'ws', sessionId: 'new', expectedRevision: null }),
      () => storage.conversations.remove('ws', 'archive', 2),
      () => storage.conversationScopes.commit({ scopeId: 'ws', expectedRevision: 2, currentSessionId: null }),
      () => storage.conversationScopes.commit({ scopeId: 'ws', expectedRevision: null }),
      () => storage.workspaces.removeBundle('ws', trashed.revision, trashed.generation),
    ];
    for (const write of writes) await expect(write()).rejects.toMatchObject({ code: 'not_found' });
    await expect(storage.workspaces.importBundle(bundle())).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await storage.changes.latestCursor()).toBe(cursor);
    await storage.workspaces.restoreBundle('ws', trashed.revision, trashed.generation);
    await expect(storage.canvas.commit({ workspaceId: 'ws', expectedRevision: 1 })).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(storage.conversations.commit({ scopeId: 'ws', sessionId: 'current', expectedRevision: 1 }))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(storage.conversationScopes.commit({ scopeId: 'ws', expectedRevision: 1, currentSessionId: null }))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    expect((await storage.conversationScopes.read('ws'))?.currentSessionId).toBe('current');
  });

  it.each(['canvas', 'generation', 'session', 'scope', 'metadata'] as const)('rolls back the whole deletion for invalid %s conditions', async problem => {
    await storage.workspaces.importBundle(bundle());
    const before = await storage.workspaces.readBundle('ws');
    const cursor = await storage.changes.latestCursor();
    const input = await deletion();
    if (problem === 'canvas') input.expectedCanvasRevision = 99;
    if (problem === 'generation') input.generation = 'old-store';
    if (problem === 'session') input.expectedConversations.sessions[0].revision = 99;
    if (problem === 'scope') input.expectedConversations.scope!.revision = 99;
    if (problem === 'metadata') input.metadata = [] as never;
    await expect(storage.workspaces.trashBundle(input)).rejects.toMatchObject({ code: problem === 'metadata' ? 'invalid_argument' : 'revision_conflict' });
    expect(await storage.workspaces.getTrashed('ws')).toBeNull();
    expect(await storage.workspaces.readBundle('ws')).toEqual(before);
    expect(await storage.changes.latestCursor()).toBe(cursor);
  });

  it('requires the current trash revision and store generation and prevents repeated restore or trash', async () => {
    await storage.workspaces.importBundle(bundle());
    const input = await deletion();
    const trashed = await storage.workspaces.trashBundle(input);
    const cursor = await storage.changes.latestCursor();
    await expect(storage.workspaces.trashBundle(input)).rejects.toMatchObject({ code: 'not_found' });
    await expect(storage.workspaces.restoreBundle('ws', 1, trashed.generation)).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(storage.workspaces.restoreBundle('ws', trashed.revision, 'other-store')).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await storage.changes.latestCursor()).toBe(cursor);
    expect(await storage.workspaces.getTrashed('ws')).toEqual(trashed);
    await storage.workspaces.restoreBundle('ws', trashed.revision, trashed.generation);
    await expect(storage.workspaces.restoreBundle('ws', trashed.revision, trashed.generation)).rejects.toMatchObject({ code: 'revision_conflict' });
    const again = await storage.workspaces.trashBundle(await deletion());
    expect(again.revision).toBe(4);
  });

  it('paginates only visible workspaces/scopes and keeps global, scheduled and other workspace history unchanged', async () => {
    for (const id of ['a', 'b', 'c']) await storage.workspaces.importBundle(bundle(id));
    for (const scopeId of ['__global_chat__', '__scheduled__-task']) {
      await storage.conversationScopes.commit({ scopeId, expectedRevision: null, currentSessionId: 'current',
        conversations: [{ sessionId: 'current', expectedRevision: null, appendMessages: [{ id: 'm', content: scopeId }] }] });
    }
    const others = await Promise.all(['__global_chat__', '__scheduled__-task', 'c'].map(id => storage.conversations.read(id, 'current')));
    await storage.workspaces.trashBundle(await deletion('a'));
    await storage.workspaces.trashBundle(await deletion('b'));
    const first = await storage.workspaces.listTrashed({ limit: 1 });
    expect(first.items[0].workspaceId).toBe('a');
    expect((await storage.workspaces.listTrashed({ limit: 1, cursor: first.nextCursor })).items[0].workspaceId).toBe('b');
    expect((await storage.canvas.list({ limit: 1 })).items.map(item => item.workspaceId)).toEqual(['c']);
    expect((await storage.conversationScopes.list()).items.map(item => item.scopeId)).toEqual(['__global_chat__', '__scheduled__-task', 'c']);
    expect(await Promise.all(['__global_chat__', '__scheduled__-task', 'c'].map(id => storage.conversations.read(id, 'current')))).toEqual(others);
  });

  it('preserves pending file intents and source files while hidden, then resumes recovery after restore', async () => {
    await storage.workspaces.importBundle(bundle());
    const filePath = join(root, 'note.md');
    await writeFile(filePath, 'Original body');
    const intent = await prepareLocalFileWrite(filePath, 'file', 'Requested body');
    await storage.canvas.commit({ workspaceId: 'ws', expectedRevision: 1,
      nodes: { put: [{ id: 'file', type: 'file', data: { filePath, content: 'Requested body' } }] }, fileWrites: [intent] });
    const trashed = await storage.workspaces.trashBundle(await deletion());
    expect(await storage.fileWrites.get(intent.id)).toBeNull();
    expect((await storage.fileWrites.list()).items).toEqual([]);
    await expect(storage.fileWrites.settle(intent.id, { status: 'applied' })).rejects.toMatchObject({ code: 'not_found' });
    expect((await recoverLocalFileWrites(storage)).items).toEqual([]);
    expect(await readFile(filePath, 'utf8')).toBe('Original body');
    await storage.workspaces.restoreBundle('ws', trashed.revision, trashed.generation);
    expect(await storage.fileWrites.get(intent.id)).toMatchObject({ ...intent, status: 'pending' });
    expect(await recoverLocalFileWrites(storage)).toMatchObject({ ok: true, applied: 1 });
    expect(await readFile(filePath, 'utf8')).toBe('Requested body');
  });

  it.each([1, 2])('upgrades schema v%s without changing retained payloads or identities', async version => {
    await storage.workspaces.importBundle(bundle());
    const before = await storage.workspaces.readBundle('ws');
    const generation = storage.generation;
    await storage.close();
    const old = new Database(path);
    old.exec('DROP TABLE workspace_trash');
    if (version === 1) old.exec('DROP TABLE local_activations');
    old.pragma(`user_version = ${version}`);
    old.close();
    storage = await openSqliteStorage({ path });
    expect(storage.generation).toBe(generation);
    expect(await storage.workspaces.readBundle('ws')).toEqual(before);
    expect((await storage.workspaces.listTrashed()).items).toEqual([]);
    const inspect = new Database(path, { readonly: true });
    try { expect(inspect.pragma('user_version', { simple: true })).toBe(3); }
    finally { inspect.close(); }
    const trashed = await storage.workspaces.trashBundle(await deletion());
    await storage.workspaces.restoreBundle('ws', trashed.revision, trashed.generation);
    expect(await storage.checkIntegrity()).toEqual({ ok: true, issues: [] });
  });
});
