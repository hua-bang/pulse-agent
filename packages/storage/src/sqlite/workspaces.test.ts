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

});
