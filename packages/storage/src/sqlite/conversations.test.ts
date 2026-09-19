import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ConversationCommit, EntityRecord, PulseStorage } from '../contracts.js';
import { openSqliteStorage } from './index.js';

let directory: string;
let path: string;
let storage: PulseStorage;
let opened: PulseStorage[];

beforeEach(async () => {
  opened = [];
  directory = await mkdtemp(join(tmpdir(), 'pulse-storage-conversations-'));
  path = join(directory, 'store.sqlite');
  storage = await openSqliteStorage({ path });
  opened = [storage];
});

afterEach(async () => {
  for (const instance of opened ?? []) await instance.close();
  await rm(directory, { recursive: true, force: true });
});

const message = (id: string, content = id): EntityRecord => ({ id, role: 'user', content });
const create = (sessionId = 'session-a', scopeId = 'scope-a', messages = [message('m-1')]) => (
  storage.conversations.commit({ scopeId, sessionId, expectedRevision: null, appendMessages: messages })
);

describe('SQLite conversation repository', () => {
  it('round-trips metadata and unknown message fields in insertion order', async () => {
    const messages: EntityRecord[] = [
      { ...message('z-last-lexically'), plugin: { version: 2, values: [true, null, '中文'] } },
      { ...message('a-first-lexically'), attachments: [{ path: '/example/image.png' }] },
    ];
    const metadata = { title: '中文 session', plugin: { enabled: true } };
    const receipt = await storage.conversations.commit({
      scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: null, metadata, appendMessages: messages,
    });

    expect(receipt.revision).toBe(1);
    expect(await storage.conversations.read('scope-a', 'session-a')).toEqual({
      generation: storage.generation,
      scopeId: 'scope-a', sessionId: 'session-a', revision: 1, metadata, messages,
    });
    expect(await storage.conversations.read('scope-a', 'missing')).toBeNull();
    expect(await storage.changes.read()).toMatchObject({ items: [{
      cursor: receipt.changeCursor, domain: 'conversation', scopeId: 'scope-a', resourceId: 'session-a',
      revision: 1, kind: 'updated', changedIds: ['z-last-lexically', 'a-first-lexically'],
    }] });
  });

  it('appends without changing earlier messages, preserves omitted metadata, and replaces explicitly', async () => {
    await storage.conversations.commit({
      scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: null,
      metadata: { title: 'Original' }, appendMessages: [message('m-1')],
    });
    await storage.conversations.commit({
      scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 1, appendMessages: [message('m-2')],
    });
    expect(await storage.conversations.read('scope-a', 'session-a')).toMatchObject({
      revision: 2, metadata: { title: 'Original' }, messages: [message('m-1'), message('m-2')],
    });
    await storage.conversations.commit({
      scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 2,
      replaceMessages: [message('m-2', 'edited'), message('m-1')],
    });
    expect(await storage.conversations.read('scope-a', 'session-a')).toMatchObject({
      revision: 3, metadata: { title: 'Original' }, messages: [message('m-2', 'edited'), message('m-1')],
    });
    await storage.conversations.commit({
      scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 3, metadata: {},
    });
    expect(await storage.conversations.read('scope-a', 'session-a')).toMatchObject({
      revision: 4, metadata: {}, messages: [message('m-2', 'edited'), message('m-1')],
    });
    await storage.conversations.commit({
      scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 4, replaceMessages: [],
    });
    expect(await storage.conversations.read('scope-a', 'session-a')).toMatchObject({ revision: 5, messages: [] });
  });

  it('rejects stale or missing revisions and permits only one concurrent writer', async () => {
    await create();
    const other = await openSqliteStorage({ path });
    opened.push(other);
    const results = await Promise.allSettled([
      storage.conversations.commit({
        scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 1, appendMessages: [message('writer-a')],
      }),
      other.conversations.commit({
        scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 1, appendMessages: [message('writer-b')],
      }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([{
      status: 'rejected', reason: { code: 'revision_conflict', expectedRevision: 1, actualRevision: 2 },
    }]);
    expect((await storage.conversations.read('scope-a', 'session-a'))?.messages).toHaveLength(2);
    await expect(create()).rejects.toMatchObject({ code: 'revision_conflict', actualRevision: 2 });
    await expect(storage.conversations.commit({
      scopeId: 'scope-a', sessionId: 'missing', expectedRevision: 1,
    })).rejects.toMatchObject({ code: 'revision_conflict', actualRevision: null });
    await expect(storage.conversations.remove('scope-a', 'session-a', 1))
      .rejects.toMatchObject({ code: 'revision_conflict', actualRevision: 2 });
    await expect(storage.conversations.remove('scope-a', 'missing', 1))
      .rejects.toMatchObject({ code: 'revision_conflict', actualRevision: null });
  });

  it.each([
    { appendMessages: [message('new'), message('m-1')] },
    { appendMessages: [message('new'), message('new')] },
    { replaceMessages: [message('replacement'), message('replacement')] },
  ])('rolls back messages, metadata, revision, and changes for duplicate IDs: %j', async mutation => {
    await create();
    const before = await storage.conversations.read('scope-a', 'session-a');
    const cursor = await storage.changes.latestCursor();
    await expect(storage.conversations.commit({
      scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 1, metadata: { title: 'Must roll back' },
      ...mutation,
    })).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await storage.conversations.read('scope-a', 'session-a')).toEqual(before);
    expect(await storage.changes.latestCursor()).toBe(cursor);
    expect(await storage.conversations.commit({
      scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 1, appendMessages: [message('retry')],
    })).toMatchObject({ revision: 2 });
  });

  it('does not leave a new conversation or change record after duplicate message IDs', async () => {
    const cursor = await storage.changes.latestCursor();
    await expect(create('session-a', 'scope-a', [message('duplicate'), message('duplicate')]))
      .rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await storage.conversations.read('scope-a', 'session-a')).toBeNull();
    expect(await storage.changes.latestCursor()).toBe(cursor);
    expect(await create()).toMatchObject({ revision: 1 });
  });

  it('keeps identical session and message IDs isolated between scopes', async () => {
    await create('shared', 'scope-a', [message('m-1', 'A')]);
    await create('shared', 'scope-b', [message('m-1', 'B')]);
    await storage.conversations.commit({
      scopeId: 'scope-a', sessionId: 'shared', expectedRevision: 1, appendMessages: [message('m-2')],
    });
    expect(await storage.conversations.read('scope-b', 'shared')).toMatchObject({
      revision: 1, messages: [message('m-1', 'B')],
    });
    await storage.conversations.remove('scope-a', 'shared', 2);
    expect(await storage.conversations.read('scope-a', 'shared')).toBeNull();
    expect(await storage.conversations.read('scope-b', 'shared')).not.toBeNull();
  });

  it('lists only the requested scope in lexical pages without message bodies', async () => {
    for (const sessionId of ['session-c', 'session-a', 'session-b']) await create(sessionId);
    await create('session-aa', 'scope-b');
    const first = await storage.conversations.list('scope-a', { limit: 2 });
    expect(first.items.map(item => item.sessionId)).toEqual(['session-a', 'session-b']);
    expect(first.items[0]).toEqual({ scopeId: 'scope-a', sessionId: 'session-a', revision: 1, metadata: {}, generation: storage.generation });
    expect(first.nextCursor).toBeTruthy();
    const second = await storage.conversations.list('scope-a', { limit: 2, cursor: first.nextCursor });
    expect(second.items.map(item => item.sessionId)).toEqual(['session-c']);
    expect(second.nextCursor).toBeUndefined();
    expect(await storage.conversations.list('missing')).toEqual({ items: [] });
    await expect(storage.conversations.list('scope-a', { cursor: '%%%invalid' }))
      .rejects.toMatchObject({ code: 'invalid_argument' });
  });

  it('removes the complete conversation and records the deleted message identities', async () => {
    await create('session-a', 'scope-a', [message('m-1'), message('m-2')]);
    const receipt = await storage.conversations.remove('scope-a', 'session-a', 1);
    expect(receipt.revision).toBe(2);
    expect(await storage.conversations.read('scope-a', 'session-a')).toBeNull();
    expect(await storage.conversations.list('scope-a')).toEqual({ items: [] });
    expect((await storage.changes.read()).items.at(-1)).toMatchObject({
      cursor: receipt.changeCursor, revision: 2, kind: 'removed', changedIds: ['m-1', 'm-2'],
    });
    await create('session-a', 'scope-a', [message('m-1', 'recreated')]);
    expect(await storage.conversations.read('scope-a', 'session-a')).toMatchObject({
      revision: 3, messages: [message('m-1', 'recreated')],
    });
    await expect(storage.conversations.commit({
      scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 1, appendMessages: [message('stale')],
    })).rejects.toMatchObject({ code: 'revision_conflict', actualRevision: 3 });
    await expect(storage.conversations.remove('scope-a', 'session-a', 1))
      .rejects.toMatchObject({ code: 'revision_conflict', actualRevision: 3 });
    expect(await storage.checkIntegrity()).toEqual({ ok: true, issues: [] });
  });

  it('rejects invalid IDs, revisions, or simultaneous append and replacement without mutations', async () => {
    await create();
    const before = await storage.conversations.read('scope-a', 'session-a');
    const invalid: ConversationCommit[] = [
      { scopeId: '', sessionId: 'session-a', expectedRevision: 1 },
      { scopeId: 'scope-a', sessionId: '', expectedRevision: 1 },
      { scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 0 },
      { scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 1.5 },
      { scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 1, appendMessages: [message('')] },
      { scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 1, appendMessages: [], replaceMessages: [] },
      // @ts-expect-error Runtime callers must not turn a malformed replacement into an empty history.
      { scopeId: 'scope-a', sessionId: 'session-a', expectedRevision: 1, replaceMessages: null },
    ];
    for (const input of invalid) {
      await expect(storage.conversations.commit(input)).rejects.toMatchObject({ code: 'invalid_argument' });
    }
    await expect(storage.conversations.read('', 'session-a')).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.conversations.read('scope-a', '')).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.conversations.list('')).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.conversations.remove('', 'session-a', 1)).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.conversations.remove('scope-a', '', 1)).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.conversations.remove('scope-a', 'session-a', 0)).rejects.toMatchObject({ code: 'invalid_argument' });
    // @ts-expect-error null is valid only for creation, never for deletion.
    await expect(storage.conversations.remove('scope-a', 'missing', null)).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await storage.conversations.read('scope-a', 'session-a')).toEqual(before);
  });
});
