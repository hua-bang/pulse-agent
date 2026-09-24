import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PulseStorage } from './contracts.js';
import { activateLocalCanvasStorage, readLocalStorageStatus } from './local.js';
import { activateLocalConversationStorage, openLocalConversationStorage, type LegacyConversationScope } from './local-conversations.js';
import { openSqliteStorage } from './sqlite/index.js';

let root: string;
let opened: PulseStorage[];
const scope = (scopeId = 'scope-a'): LegacyConversationScope => ({
  scopeId, currentSessionId: 'current', conversations: [{
    sessionId: 'current', metadata: { title: 'Current', pinned: true },
    messages: [{ id: 'stable-1', role: 'user', content: 'hello', timestamp: 1 }],
  }, {
    sessionId: 'archived', metadata: { title: 'Archive' },
    messages: [{ id: 'stable-2', role: 'assistant', content: 'kept', timestamp: 2 }],
  }],
});

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'pulse-conversation-migration-')); opened = []; });
afterEach(async () => {
  for (const store of opened) await store.close();
  await rm(root, { recursive: true, force: true });
});

async function activate(scopes: LegacyConversationScope[]) {
  const storage = await activateLocalConversationStorage({ root, loadLegacyScopes: async () => scopes });
  opened.push(storage);
  return storage;
}

describe('local conversation activation', () => {
  it('keeps conversations inactive until import succeeds and preserves an existing Canvas domain', async () => {
    const canvas = await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: async () => [{
      workspaceId: 'canvas', metadata: { title: 'Untouched' }, nodes: [{ id: 'node' }], placements: [], edges: [],
    }] });
    opened.push(canvas);
    expect(await openLocalConversationStorage({ root })).toBeNull();
    const storage = await activate([scope()]);
    expect((await readLocalStorageStatus(root))?.domains).toEqual(['canvas', 'conversations']);
    expect(await storage.canvas.read('canvas')).toMatchObject({ revision: 1, metadata: { title: 'Untouched' }, nodes: [{ id: 'node' }] });
    expect(await storage.conversationScopes.read('scope-a')).toMatchObject({ currentSessionId: 'current' });
    expect(await storage.conversations.read('scope-a', 'current')).toMatchObject({ metadata: { pinned: true }, messages: scope().conversations[0].messages });
    expect(await storage.conversations.read('scope-a', 'archived')).not.toBeNull();
    const backup = (await readdir(join(root, '__storage-backup__'))).find(file => file.startsWith('conversations-'))!;
    expect(JSON.parse(await readFile(join(root, '__storage-backup__', backup), 'utf8'))).toMatchObject({ scopes: [scope()] });
  });

  it('repairs a partial unactivated import from fresh source scopes', async () => {
    const invalid = scope('broken');
    invalid.conversations[0].messages.push({ ...invalid.conversations[0].messages[0] });
    await expect(activate([scope('obsolete'), scope(), invalid])).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await openLocalConversationStorage({ root })).toBeNull();
    expect(await readLocalStorageStatus(root)).toBeNull();
    const staged = await openSqliteStorage({ path: join(root, '__storage__.sqlite') });
    opened.push(staged);
    expect(await staged.conversations.read('scope-a', 'archived')).not.toBeNull();
    await staged.close();
    const changed = scope();
    changed.currentSessionId = 'archived';
    changed.conversations = [changed.conversations[1]];
    const storage = await activate([changed]);
    expect((await storage.conversationScopes.read('scope-a'))?.currentSessionId).toBe('archived');
    expect(await storage.conversations.read('scope-a', 'current')).toBeNull();
    expect((await storage.conversations.list('obsolete')).items).toEqual([]);
    expect((await readLocalStorageStatus(root))?.domains).toEqual(['conversations']);
  });

  it('does not import old files again once conversations are authoritative', async () => {
    const first = await activate([scope()]);
    await first.conversations.commit({
      scopeId: 'scope-a', sessionId: 'current', expectedRevision: 1, expectedGeneration: first.generation,
      appendMessages: [{ id: 'new-message', content: 'database-only' }],
    });
    const loadLegacyScopes = vi.fn(async () => []);
    const second = await activateLocalConversationStorage({ root, loadLegacyScopes });
    opened.push(second);
    expect(loadLegacyScopes).not.toHaveBeenCalled();
    expect((await second.conversations.read('scope-a', 'current'))?.messages).toHaveLength(2);
  });

  it('leaves the marker unchanged if source conversations change during migration', async () => {
    const reader = vi.fn().mockResolvedValueOnce([scope()]).mockResolvedValueOnce([]);
    await expect(activateLocalConversationStorage({ root, loadLegacyScopes: reader }))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await readLocalStorageStatus(root)).toBeNull();
    expect(await openLocalConversationStorage({ root })).toBeNull();
  });
});
