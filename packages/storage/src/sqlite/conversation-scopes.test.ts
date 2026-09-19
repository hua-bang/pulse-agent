import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EntityRecord, PulseStorage } from '../contracts.js';
import { openSqliteStorage } from './index.js';

let root: string;
let path: string;
let storage: PulseStorage;
let opened: PulseStorage[];
const message = (id: string): EntityRecord => ({ id, role: 'user', content: id, timestamp: 1 });

beforeEach(async () => {
  opened = [];
  root = await mkdtemp(join(tmpdir(), 'pulse-conversation-scopes-'));
  path = join(root, 'storage.sqlite');
  storage = await openSqliteStorage({ path });
  opened.push(storage);
});

afterEach(async () => {
  for (const store of opened) await store.close();
  await rm(root, { recursive: true, force: true });
});

function createScope(scopeId = 'scope-a', sessionId = 'source') {
  return storage.conversationScopes.commit({
    scopeId, expectedRevision: null, expectedGeneration: storage.generation, currentSessionId: sessionId,
    conversations: [{
      sessionId, expectedRevision: null,
      metadata: { title: 'Source', pinned: true, startedAt: '2026-09-19T00:00:00Z' },
      appendMessages: [message('m-1'), message('m-2'), message('m-3')],
    }],
  });
}

describe('SQLite conversation scope transactions', () => {
  it('creates history and its current pointer with matching committed change records', async () => {
    const receipt = await createScope();
    expect(await storage.conversationScopes.read('scope-a')).toEqual({
      scopeId: 'scope-a', currentSessionId: 'source', revision: 1, generation: storage.generation,
    });
    expect(await storage.conversations.read('scope-a', 'source')).toMatchObject({
      revision: 1, metadata: { title: 'Source', pinned: true }, messages: [message('m-1'), message('m-2'), message('m-3')],
    });
    expect((await storage.changes.read()).items.map(change => change.domain)).toEqual(['conversation', 'conversation-scope']);
    expect(await storage.changes.latestCursor()).toBe(receipt.changeCursor);
    expect((await storage.changes.read()).items.at(-1)).toMatchObject({
      domain: 'conversation-scope', resourceId: 'scope-a', revision: 1, changedIds: ['source'],
    });
  });

  it('branches a message prefix and switches the pointer without modifying the source', async () => {
    await createScope();
    const source = (await storage.conversations.read('scope-a', 'source'))!;
    await storage.conversationScopes.commit({
      scopeId: 'scope-a', expectedRevision: 1, currentSessionId: 'branch',
      assertConversations: [{ sessionId: 'source', expectedRevision: source.revision }],
      conversations: [{
        sessionId: 'branch', expectedRevision: null,
        metadata: { branchSource: 'source' }, appendMessages: source.messages.slice(0, 2),
      }],
    });
    expect(await storage.conversations.read('scope-a', 'source')).toEqual(source);
    expect(await storage.conversations.read('scope-a', 'branch')).toMatchObject({
      revision: 1, metadata: { branchSource: 'source' }, messages: source.messages.slice(0, 2),
    });
    expect(await storage.conversationScopes.read('scope-a')).toMatchObject({ revision: 2, currentSessionId: 'branch' });

    await storage.conversations.commit({ scopeId: 'scope-a', sessionId: 'source', expectedRevision: 1, appendMessages: [message('later')] });
    const cursor = await storage.changes.latestCursor();
    await expect(storage.conversationScopes.commit({
      scopeId: 'scope-a', expectedRevision: 2, currentSessionId: 'stale-branch',
      assertConversations: [{ sessionId: 'source', expectedRevision: 1 }],
      conversations: [{ sessionId: 'stale-branch', expectedRevision: null, appendMessages: source.messages.slice(0, 1) }],
    })).rejects.toMatchObject({ code: 'revision_conflict', actualRevision: 2 });
    expect(await storage.conversations.read('scope-a', 'stale-branch')).toBeNull();
    expect(await storage.changes.latestCursor()).toBe(cursor);
  });

  it('archives by clearing only the pointer and preserves an omitted pointer', async () => {
    await createScope();
    const source = await storage.conversations.read('scope-a', 'source');
    await storage.conversationScopes.commit({ scopeId: 'scope-a', expectedRevision: 1 });
    expect(await storage.conversationScopes.read('scope-a')).toMatchObject({ revision: 2, currentSessionId: 'source' });
    await storage.conversationScopes.commit({ scopeId: 'scope-a', expectedRevision: 2, currentSessionId: null });
    expect(await storage.conversationScopes.read('scope-a')).toMatchObject({ revision: 3, currentSessionId: null });
    expect(await storage.conversations.read('scope-a', 'source')).toEqual(source);
  });

  it('rolls back all message changes and revisions if a pointer target does not exist', async () => {
    await createScope();
    const source = await storage.conversations.read('scope-a', 'source');
    const cursor = await storage.changes.latestCursor();
    await expect(storage.conversationScopes.commit({
      scopeId: 'scope-a', expectedRevision: 1, currentSessionId: 'missing',
      conversations: [
        { sessionId: 'source', expectedRevision: 1, metadata: { title: 'Rollback' }, appendMessages: [message('tentative')] },
        { sessionId: 'new', expectedRevision: null, appendMessages: [message('tentative-new')] },
      ],
    })).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await storage.conversations.read('scope-a', 'source')).toEqual(source);
    expect(await storage.conversations.read('scope-a', 'new')).toBeNull();
    expect(await storage.conversationScopes.read('scope-a')).toMatchObject({ revision: 1, currentSessionId: 'source' });
    expect(await storage.changes.latestCursor()).toBe(cursor);
    const retry = await storage.conversationScopes.commit({
      scopeId: 'scope-a', expectedRevision: 1, currentSessionId: 'new',
      conversations: [{ sessionId: 'new', expectedRevision: null }],
    });
    expect(retry.revision).toBe(2);
    expect(await storage.conversations.read('scope-a', 'new')).toMatchObject({ revision: 1 });
  });

  it('rejects deleting a current conversation until the pointer is cleared or switched', async () => {
    await createScope();
    const cursor = await storage.changes.latestCursor();
    await expect(storage.conversationScopes.commit({
      scopeId: 'scope-a', expectedRevision: 1,
      removeConversations: [{ sessionId: 'source', expectedRevision: 1 }],
    })).rejects.toMatchObject({ code: 'invalid_argument' });
    await expect(storage.conversations.remove('scope-a', 'source', 1)).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await storage.changes.latestCursor()).toBe(cursor);
    await storage.conversationScopes.commit({
      scopeId: 'scope-a', expectedRevision: 1, currentSessionId: null,
      removeConversations: [{ sessionId: 'source', expectedRevision: 1 }],
    });
    expect(await storage.conversations.read('scope-a', 'source')).toBeNull();
    expect(await storage.conversationScopes.read('scope-a')).toMatchObject({ currentSessionId: null, revision: 2 });
    expect(await storage.checkIntegrity()).toEqual({ ok: true, issues: [] });
  });

  it('atomically replaces a deleted current session with a new draft and rolls back a stale deletion', async () => {
    await createScope();
    const cursor = await storage.changes.latestCursor();
    const replacement = {
      scopeId: 'scope-a', expectedRevision: 1, currentSessionId: 'draft',
      conversations: [{ sessionId: 'draft', expectedRevision: null }],
    };
    await expect(storage.conversationScopes.commit({
      ...replacement, removeConversations: [{ sessionId: 'source', expectedRevision: 99 }],
    })).rejects.toMatchObject({ code: 'revision_conflict', actualRevision: 1 });
    expect(await storage.conversationScopes.read('scope-a')).toMatchObject({ currentSessionId: 'source', revision: 1 });
    expect(await storage.conversations.read('scope-a', 'draft')).toBeNull();
    expect(await storage.changes.latestCursor()).toBe(cursor);
    await storage.conversationScopes.commit({
      ...replacement, removeConversations: [{ sessionId: 'source', expectedRevision: 1 }],
    });
    expect(await storage.conversationScopes.read('scope-a')).toMatchObject({ currentSessionId: 'draft', revision: 2 });
    expect(await storage.conversations.read('scope-a', 'source')).toBeNull();
    expect(await storage.conversations.read('scope-a', 'draft')).toMatchObject({ revision: 1, messages: [] });
  });

  it('rolls back earlier conversations when a later message batch is invalid', async () => {
    await createScope();
    const before = await storage.conversations.read('scope-a', 'source');
    const cursor = await storage.changes.latestCursor();
    await expect(storage.conversationScopes.commit({
      scopeId: 'scope-a', expectedRevision: 1, currentSessionId: 'new',
      conversations: [
        { sessionId: 'source', expectedRevision: 1, appendMessages: [message('tentative')] },
        { sessionId: 'new', expectedRevision: null, appendMessages: [message('duplicate'), message('duplicate')] },
      ],
    })).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await storage.conversations.read('scope-a', 'source')).toEqual(before);
    expect(await storage.conversations.read('scope-a', 'new')).toBeNull();
    expect(await storage.changes.latestCursor()).toBe(cursor);
  });

  it('isolates identical session IDs across scopes and never points into another scope', async () => {
    await createScope('scope-a', 'shared');
    await createScope('scope-b', 'shared');
    await storage.conversations.commit({ scopeId: 'scope-b', sessionId: 'b-only', expectedRevision: null });
    await expect(storage.conversationScopes.commit({
      scopeId: 'scope-a', expectedRevision: 1, currentSessionId: 'b-only',
    })).rejects.toMatchObject({ code: 'invalid_argument' });
    await storage.conversationScopes.commit({
      scopeId: 'scope-a', expectedRevision: 1, currentSessionId: null,
      removeConversations: [{ sessionId: 'shared', expectedRevision: 1 }],
    });
    expect(await storage.conversations.read('scope-a', 'shared')).toBeNull();
    expect(await storage.conversations.read('scope-b', 'shared')).toMatchObject({ revision: 1 });
    expect(await storage.conversationScopes.read('scope-b')).toMatchObject({ currentSessionId: 'shared', revision: 1 });
  });

  it('uses separate scope revisions even when the scope and session IDs match', async () => {
    await createScope('same-id', 'same-id');
    await storage.conversations.commit({ scopeId: 'same-id', sessionId: 'same-id', expectedRevision: 1, appendMessages: [message('later')] });
    expect(await storage.conversationScopes.read('same-id')).toMatchObject({ revision: 1 });
    await storage.conversationScopes.commit({ scopeId: 'same-id', expectedRevision: 1, currentSessionId: null });
    expect(await storage.conversationScopes.read('same-id')).toMatchObject({ revision: 2 });
    expect(await storage.conversations.read('same-id', 'same-id')).toMatchObject({ revision: 2 });
  });

  it('enforces generation and scope CAS across connections', async () => {
    await createScope();
    await expect(storage.conversationScopes.commit({
      scopeId: 'scope-a', expectedRevision: 1, expectedGeneration: 'replaced-database', currentSessionId: null,
    })).rejects.toMatchObject({ code: 'revision_conflict' });
    const other = await openSqliteStorage({ path });
    opened.push(other);
    const results = await Promise.allSettled([
      storage.conversationScopes.commit({ scopeId: 'scope-a', expectedRevision: 1, currentSessionId: null }),
      other.conversationScopes.commit({ scopeId: 'scope-a', expectedRevision: 1, currentSessionId: 'source' }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toMatchObject([{
      status: 'rejected', reason: { code: 'revision_conflict', actualRevision: 2 },
    }]);
    expect(await other.conversationScopes.read('scope-a')).toMatchObject({ revision: 2, currentSessionId: null });
  });

  it('lists scopes without reading message bodies and persists empty scopes with null pointers', async () => {
    for (const scopeId of ['scope-c', 'scope-a', 'scope-b']) {
      await storage.conversationScopes.commit({ scopeId, expectedRevision: null });
    }
    const first = await storage.conversationScopes.list({ limit: 2 });
    expect(first.items.map(scope => scope.scopeId)).toEqual(['scope-a', 'scope-b']);
    expect(first.items.every(scope => scope.currentSessionId === null)).toBe(true);
    const next = await storage.conversationScopes.list({ cursor: first.nextCursor, limit: 2 });
    expect(next.items.map(scope => scope.scopeId)).toEqual(['scope-c']);
    expect(next.nextCursor).toBeUndefined();
    await storage.close();
    const reopened = await openSqliteStorage({ path });
    opened.push(reopened);
    expect(await reopened.conversationScopes.read('scope-a')).toMatchObject({ currentSessionId: null, revision: 1 });
  });
});
