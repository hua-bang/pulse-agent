import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PulseStorage } from '../contracts.js';
import { openSqliteStorage } from './index.js';

let root: string;
const stores: PulseStorage[] = [];

async function openStore(path = join(root, 'pulse.sqlite'), busyTimeoutMs?: number) {
  const store = await openSqliteStorage({ path, busyTimeoutMs });
  stores.push(store);
  return store;
}

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'pulse-storage-')); });
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  await rm(root, { recursive: true, force: true });
});

describe('SQLite lifecycle and recovery contract', () => {
  it('reopens committed records and the matching change cursor', async () => {
    const first = await openStore();
    const receipt = await first.canvas.commit({
      workspaceId: 'ws', expectedRevision: null,
      metadata: { name: 'Research' },
      nodes: { put: [{ id: 'note', type: 'file', data: { filePath: 'notes/a.md' } }] },
    });
    await first.close();
    const second = await openStore();
    expect((await second.canvas.read('ws'))?.revision).toBe(receipt.revision);
    expect(await second.changes.latestCursor()).toBe(receipt.changeCursor);
    expect(await second.checkIntegrity()).toEqual({ ok: true, issues: [] });
  });

  it('makes a consistent backup while another connection remains open', async () => {
    const first = await openStore();
    const second = await openStore();
    await first.canvas.commit({ workspaceId: 'ws', expectedRevision: null, metadata: { title: 'kept' } });
    await second.conversations.commit({
      scopeId: 'ws', sessionId: 's', expectedRevision: null,
      appendMessages: [{ id: 'm', role: 'user', content: 'hello' }],
    });
    const backup = join(root, 'backups', 'snapshot.sqlite');
    await first.backup(backup);
    const restored = await openStore(backup);
    expect((await restored.canvas.read('ws'))?.metadata).toEqual({ title: 'kept' });
    expect((await restored.conversations.read('ws', 's'))?.messages).toHaveLength(1);
    expect(await restored.changes.latestCursor()).toBe(await second.changes.latestCursor());
    expect(await restored.checkIntegrity()).toEqual({ ok: true, issues: [] });
  });

  it('does not overwrite an existing backup destination', async () => {
    const store = await openStore();
    const target = join(root, 'important.txt');
    await writeFile(target, 'preserve');
    await expect(store.backup(target)).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await readFile(target, 'utf8')).toBe('preserve');
  });

  it('rejects a newer schema without resetting its version', async () => {
    const path = join(root, 'future.sqlite');
    const future = new Database(path);
    future.pragma('user_version = 999');
    future.close();
    await expect(openStore(path)).rejects.toMatchObject({ code: 'unsupported_schema' });
    const inspect = new Database(path);
    try { expect(inspect.pragma('user_version', { simple: true })).toBe(999); }
    finally { inspect.close(); }
  });

  it('reports an unreadable database instead of treating it as an empty store', async () => {
    const path = join(root, 'broken.sqlite');
    await writeFile(path, 'not a sqlite database');
    await expect(openStore(path)).rejects.toMatchObject({ code: 'corrupt_data' });
    expect(await readFile(path, 'utf8')).toBe('not a sqlite database');
  });

  it('returns a bounded busy error with no partial commit', async () => {
    const store = await openStore(join(root, 'pulse.sqlite'), 10);
    const other = new Database(join(root, 'pulse.sqlite'));
    try {
      other.exec('BEGIN IMMEDIATE');
      await expect(store.canvas.commit({
        workspaceId: 'blocked', expectedRevision: null,
      })).rejects.toMatchObject({ code: 'storage_busy' });
      other.exec('ROLLBACK');
      expect(await store.canvas.read('blocked')).toBeNull();
      expect((await store.changes.read()).items).toEqual([]);
      await expect(store.canvas.commit({
        workspaceId: 'blocked', expectedRevision: null,
      })).resolves.toMatchObject({ revision: 1 });
    } finally {
      if (other.inTransaction) other.exec('ROLLBACK');
      other.close();
    }
  });

  it('keeps change cursors resumable across domain writes', async () => {
    const store = await openStore();
    const first = await store.canvas.commit({ workspaceId: 'ws', expectedRevision: null });
    await store.conversations.commit({ scopeId: 'ws', sessionId: 'a', expectedRevision: null });
    await store.canvas.commit({ workspaceId: 'ws', expectedRevision: first.revision });
    const page = await store.changes.read({ cursor: first.changeCursor, limit: 1 });
    expect(page.items.map(change => change.domain)).toEqual(['conversation']);
    expect(page.nextCursor).toBeDefined();
    const last = await store.changes.read({ cursor: page.nextCursor });
    expect(last.items.map(change => change.domain)).toEqual(['canvas']);
    expect(last.nextCursor).toBeUndefined();
    await expect(store.changes.read({ cursor: '!!!' })).rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('closes idempotently and rejects later operations consistently', async () => {
    const store = await openStore();
    await store.close();
    await store.close();
    await expect(store.canvas.read('ws')).rejects.toMatchObject({ code: 'storage_closed' });
    await expect(store.conversations.read('ws', 's')).rejects.toMatchObject({ code: 'storage_closed' });
    await expect(store.changes.latestCursor()).rejects.toMatchObject({ code: 'storage_closed' });
    await expect(store.backup(join(root, 'closed.sqlite'))).rejects.toMatchObject({ code: 'storage_closed' });
  });
});
