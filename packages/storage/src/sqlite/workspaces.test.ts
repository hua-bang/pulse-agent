import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PulseStorage } from '../contracts.js';
import type { WorkspaceBundleImport } from '../workspace-contracts.js';
import { openSqliteStorage } from './index.js';

let root: string;
let storage: PulseStorage;
const bundle = (workspaceId = 'ws'): WorkspaceBundleImport => ({
  canvas: {
    workspaceId, metadata: { title: 'Imported' }, nodes: [{ id: 'on-canvas', data: { body: 'body' } }, { id: 'off-canvas' }],
    placements: [{ id: 'on-canvas', x: 20 }], edges: [{ id: 'edge', source: 'on-canvas', target: 'on-canvas' }],
  },
  currentSessionId: 'current',
  conversations: [{ sessionId: 'current', metadata: { title: 'Chat', pinned: true }, messages: [{ id: 'message', content: 'history' }] },
    { sessionId: 'archive', metadata: {}, messages: [{ id: 'old-message', content: 'archive history' }] }],
});

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pulse-workspace-bundle-'));
  storage = await openSqliteStorage({ path: join(root, 'store.sqlite') });
});
afterEach(async () => {
  await storage.close();
  await rm(root, { recursive: true, force: true });
});

describe('workspace business transactions', () => {
  it('imports and reads Canvas, complete conversation history, and its pointer as one bundle', async () => {
    const input = bundle();
    const receipt = await storage.workspaces.importBundle(input);
    const read = (await storage.workspaces.readBundle('ws'))!;
    expect(read.canvas).toEqual({
      ...input.canvas, nodes: [...input.canvas.nodes].sort((left, right) => left.id.localeCompare(right.id)),
      revision: 1, generation: storage.generation,
    });
    expect(read.conversationScope).toMatchObject({ currentSessionId: 'current', revision: 1 });
    expect(read.conversations.map(conversation => conversation.sessionId)).toEqual(['archive', 'current']);
    expect(read.conversations.find(conversation => conversation.sessionId === 'current')).toMatchObject(input.conversations![0]);
    expect(read.conversationState).toEqual(receipt.conversationState);
    expect(receipt.conversationState.sessions.every(session => session.generation === storage.generation)).toBe(true);
    expect(await storage.changes.latestCursor()).toBe(receipt.changeCursor);
    expect(await storage.workspaces.readBundle('missing')).toBeNull();
  });

  it.each(['missing-pointer', 'duplicate-message'])('rolls back every domain and change record when import has %s', async failure => {
    const input = bundle();
    if (failure === 'missing-pointer') input.currentSessionId = 'missing';
    else input.conversations![0].messages.push({ ...input.conversations![0].messages[0] });
    const cursor = await storage.changes.latestCursor();
    await expect(storage.workspaces.importBundle(input)).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await storage.canvas.read('ws')).toBeNull();
    expect(await storage.conversationScopes.read('ws')).toBeNull();
    expect((await storage.conversations.list('ws')).items).toEqual([]);
    expect(await storage.changes.latestCursor()).toBe(cursor);
    const retry = await storage.workspaces.importBundle(bundle());
    expect(retry.revision).toBe(1);
    expect(retry.conversationState.scope?.revision).toBe(1);
    expect(retry.conversationState.sessions.every(session => session.revision === 1)).toBe(true);
  });

  it('refuses to overwrite an existing Canvas or claim a scope with existing conversations', async () => {
    await storage.workspaces.importBundle(bundle());
    const before = await storage.workspaces.readBundle('ws');
    await expect(storage.workspaces.importBundle(bundle())).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await storage.workspaces.readBundle('ws')).toEqual(before);
    await storage.conversations.commit({ scopeId: 'occupied', sessionId: 'kept', expectedRevision: null });
    await expect(storage.workspaces.importBundle(bundle('occupied'))).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await storage.canvas.read('occupied')).toBeNull();
    expect(await storage.conversations.read('occupied', 'kept')).not.toBeNull();
  });

  it('removes all workspace rows without changing global, scheduled, or another workspace history', async () => {
    await storage.workspaces.importBundle(bundle());
    await storage.workspaces.importBundle(bundle('other'));
    for (const scopeId of ['__global_chat__', '__scheduled__-task']) {
      await storage.conversationScopes.commit({
        scopeId, expectedRevision: null, currentSessionId: 'current',
        conversations: [{ sessionId: 'current', expectedRevision: null, appendMessages: [{ id: 'message', content: scopeId }] }],
      });
    }
    await storage.workspaces.removeBundle('ws', 1, storage.generation);
    expect(await storage.workspaces.readBundle('ws')).toBeNull();
    expect(await storage.conversationScopes.read('ws')).toBeNull();
    expect((await storage.conversations.list('ws')).items).toEqual([]);
    for (const scopeId of ['__global_chat__', '__scheduled__-task', 'other']) {
      expect(await storage.conversationScopes.read(scopeId)).toMatchObject({ currentSessionId: 'current', revision: 1 });
      expect(await storage.conversations.read(scopeId, 'current')).not.toBeNull();
    }
    expect(await storage.checkIntegrity()).toEqual({ ok: true, issues: [] });
  });

  it('requires matching Canvas revision and database generation before deleting any conversation', async () => {
    await storage.workspaces.importBundle(bundle());
    const before = await storage.workspaces.readBundle('ws');
    const cursor = await storage.changes.latestCursor();
    await expect(storage.workspaces.removeBundle('ws', 99, storage.generation)).rejects.toMatchObject({ code: 'revision_conflict' });
    await expect(storage.workspaces.removeBundle('ws', 1, 'old-store')).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await storage.workspaces.readBundle('ws')).toEqual(before);
    expect(await storage.changes.latestCursor()).toBe(cursor);
  });

  it.each(['message-edit', 'new-session', 'pointer-change'])('keeps the imported workspace if compensation detects later %s', async change => {
    const receipt = await storage.workspaces.importBundle(bundle());
    if (change === 'message-edit') {
      await storage.conversations.commit({
        scopeId: 'ws', sessionId: 'current', expectedRevision: 1,
        appendMessages: [{ id: 'later', content: 'New user work' }],
      });
    } else if (change === 'new-session') {
      await storage.conversations.commit({ scopeId: 'ws', sessionId: 'later', expectedRevision: null });
    } else {
      await storage.conversationScopes.commit({ scopeId: 'ws', expectedRevision: 1, currentSessionId: 'archive' });
    }
    const before = await storage.workspaces.readBundle('ws');
    await expect(storage.workspaces.removeBundle('ws', receipt.revision, receipt.generation, receipt.conversationState))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await storage.workspaces.readBundle('ws')).toEqual(before);
  });

  it('rejects foreign-generation conversation conditions and permits unchanged import compensation', async () => {
    const receipt = await storage.workspaces.importBundle(bundle());
    const foreign = {
      ...receipt.conversationState,
      sessions: receipt.conversationState.sessions.map(session => ({ ...session, generation: 'old-database' })),
    };
    await expect(storage.workspaces.removeBundle('ws', receipt.revision, receipt.generation, foreign))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    await storage.workspaces.removeBundle('ws', receipt.revision, receipt.generation, receipt.conversationState);
    expect(await storage.workspaces.readBundle('ws')).toBeNull();
    const recreated = await storage.workspaces.importBundle(bundle());
    expect(recreated.revision).toBe(3);
    expect(recreated.conversationState.scope?.revision).toBe(3);
    expect(recreated.conversationState.sessions.every(session => session.revision === 3)).toBe(true);
  });
});
