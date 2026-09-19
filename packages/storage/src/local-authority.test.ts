import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { activateLocalCanvasStorage, openLocalStorage, readLocalStorageStatus, withLegacyCanvasWrite, type LegacyCanvasWorkspace } from './local.js';
import { activateLocalConversationStorage } from './local-conversations.js';
import { openSqliteStorage, type SqliteStorage } from './sqlite/index.js';
import type { PulseStorage } from './contracts.js';

let root: string;
const stores: PulseStorage[] = [];
const legacy: LegacyCanvasWorkspace[] = [{
  workspaceId: 'original', metadata: {}, placements: [], edges: [],
  nodes: [{ id: 'n', type: 'text', data: { content: 'legacy' } }],
}];
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'local-authority-')); });
afterEach(async () => {
  for (const store of stores.splice(0)) await store.close();
  await rm(root, { recursive: true, force: true });
});
const track = <T extends PulseStorage>(store: T): T => { stores.push(store); return store; };

describe('database-owned local activation', () => {
  it('restores a missing marker without reverting SQL edits or deleting SQL-only workspaces', async () => {
    const initial = track(await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: async () => legacy }));
    await initial.canvas.commit({ workspaceId: 'original', expectedRevision: 1, nodes: { put: [{ id: 'n', data: { content: 'new SQL edit' } }] } });
    await initial.canvas.commit({ workspaceId: 'sql-only', expectedRevision: null });
    await initial.close();
    await unlink(join(root, '__storage__.json'));
    const source = vi.fn(async () => legacy);
    const recovered = track(await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: source }));
    expect(source).not.toHaveBeenCalled();
    expect((await recovered.canvas.readNode('original', 'n'))?.data).toEqual({ content: 'new SQL edit' });
    expect(await recovered.canvas.read('sql-only')).not.toBeNull();
    expect(JSON.parse(await readFile(join(root, '__storage__.json'), 'utf8')).domains).toEqual(['canvas']);
  });

  it('protects conversation messages and the current pointer after marker loss', async () => {
    const source = vi.fn(async () => [{ scopeId: 'ws', currentSessionId: 's', conversations: [{ sessionId: 's', metadata: {}, messages: [{ id: 'm1', content: 'old' }] }] }]);
    const initial = track(await activateLocalConversationStorage({ root, loadLegacyScopes: source }));
    await initial.conversations.commit({ scopeId: 'ws', sessionId: 's', expectedRevision: 1, appendMessages: [{ id: 'm2', content: 'new' }] });
    await initial.close();
    source.mockClear();
    await unlink(join(root, '__storage__.json'));
    const recovered = track(await activateLocalConversationStorage({ root, loadLegacyScopes: source }));
    expect(source).not.toHaveBeenCalled();
    expect((await recovered.conversations.read('ws', 's'))?.messages.map(message => message.id)).toEqual(['m1', 'm2']);
    expect((await recovered.conversationScopes.read('ws'))?.currentSessionId).toBe('s');
  });

  it('uses the complete database domain set when recreating a marker', async () => {
    track(await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: async () => legacy }));
    track(await activateLocalConversationStorage({ root, loadLegacyScopes: async () => [] }));
    await unlink(join(root, '__storage__.json'));
    const connections = await Promise.all([openLocalStorage({ root }), openLocalStorage({ root })]);
    connections.forEach(store => { if (store) track(store); });
    expect(JSON.parse(await readFile(join(root, '__storage__.json'), 'utf8')).domains).toEqual(['canvas', 'conversations']);
  });

  it('recovers a cutover whose database commit succeeded but marker publication failed', async () => {
    let reads = 0;
    await expect(activateLocalCanvasStorage({ root, loadLegacyWorkspaces: async () => {
      if (++reads === 2) await mkdir(join(root, '__storage__.json'));
      return legacy;
    } })).rejects.toMatchObject({ code: 'storage_unavailable' });
    await rm(join(root, '__storage__.json'), { recursive: true });
    const source = vi.fn(async () => []);
    const recovered = track(await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: source }));
    expect(source).not.toHaveBeenCalled();
    expect(await recovered.canvas.read('original')).not.toBeNull();
  });

  it('repairs a stale first-domain marker before reading any legacy conversation source', async () => {
    track(await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: async () => legacy }));
    const initial = track(await activateLocalConversationStorage({ root, loadLegacyScopes: async () => [{
      scopeId: 'ws', currentSessionId: 's', conversations: [{ sessionId: 's', metadata: {}, messages: [{ id: 'm', content: 'keep' }] }],
    }] }));
    await initial.close();
    await writeFile(join(root, '__storage__.json'), JSON.stringify({ schemaVersion: 1, backend: 'sqlite', domains: ['canvas'] }));
    const source = vi.fn(async () => { throw new Error('Old JSON is corrupt'); });
    const recovered = track(await activateLocalConversationStorage({ root, loadLegacyScopes: source }));
    expect(source).not.toHaveBeenCalled();
    expect((await recovered.conversations.read('ws', 's'))?.messages[0].content).toBe('keep');
    expect((await readLocalStorageStatus(root))?.domains).toEqual(['canvas', 'conversations']);
  });

  it.each([false, true])('does not call unregistered SQL data or deletion history an unfinished import (deleted=%s)', async deleted => {
    const initial = track(await activateLocalConversationStorage({ root, loadLegacyScopes: async () => [] }));
    await initial.canvas.commit({ workspaceId: 'unregistered', expectedRevision: null });
    if (deleted) await initial.canvas.remove('unregistered', 1);
    await expect(activateLocalCanvasStorage({ root, loadLegacyWorkspaces: async () => legacy })).rejects.toMatchObject({ code: 'corrupt_data' });
    expect(Boolean(await initial.canvas.read('unregistered'))).toBe(!deleted);
    expect(await initial.canvas.read('original')).toBeNull();
  });

  it('does not let a stale domain projection authorize writes to a frozen legacy store', async () => {
    track(await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: async () => legacy }));
    track(await activateLocalConversationStorage({ root, loadLegacyScopes: async () => [] }));
    await writeFile(join(root, '__storage__.json'), JSON.stringify({ schemaVersion: 1, backend: 'sqlite', domains: ['conversations'] }));
    const write = vi.fn(async () => undefined);
    await expect(withLegacyCanvasWrite(root, write)).rejects.toMatchObject({ code: 'storage_unavailable' });
    expect(write).not.toHaveBeenCalled();
    expect((await readLocalStorageStatus(root))?.domains).toEqual(['canvas', 'conversations']);
  });

  it('fails closed for an existing database with no evidence of an unfinished import', async () => {
    const existing = track(await openSqliteStorage({ path: join(root, '__storage__.sqlite') }));
    await existing.canvas.commit({ workspaceId: 'keep', expectedRevision: null });
    await existing.close();
    const source = vi.fn(async () => legacy);
    await expect(activateLocalCanvasStorage({ root, loadLegacyWorkspaces: source })).rejects.toMatchObject({ code: 'corrupt_data' });
    expect(source).not.toHaveBeenCalled();
    const verified = track(await openSqliteStorage({ path: join(root, '__storage__.sqlite') }));
    expect(await verified.canvas.read('keep')).not.toBeNull();
  });

  it.each([false, true])('upgrades old SQL authority only with a surviving v1 marker (marker=%s)', async markerExists => {
    const existing = track(await openSqliteStorage({ path: join(root, '__storage__.sqlite') }));
    await existing.canvas.commit({ workspaceId: 'keep', expectedRevision: null });
    await existing.close();
    const driver = new Database(join(root, '__storage__.sqlite'));
    driver.exec('DROP TABLE workspace_trash; DROP TABLE local_activations; PRAGMA user_version = 1');
    driver.close();
    if (markerExists) await writeFile(join(root, '__storage__.json'), JSON.stringify({ schemaVersion: 1, backend: 'sqlite', domains: ['canvas'] }));
    const source = vi.fn(async () => legacy);
    if (markerExists) {
      const storage = track(await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: source })) as SqliteStorage;
      expect(await storage.canvas.read('keep')).not.toBeNull();
      expect(await storage.localActivation.read()).toEqual([{ domain: 'canvas', state: 'active' }]);
      await unlink(join(root, '__storage__.json'));
      expect((await readLocalStorageStatus(root))?.domains).toEqual(['canvas']);
    } else {
      await expect(activateLocalCanvasStorage({ root, loadLegacyWorkspaces: source })).rejects.toMatchObject({ code: 'corrupt_data' });
    }
    expect(source).not.toHaveBeenCalled();
  });
});
