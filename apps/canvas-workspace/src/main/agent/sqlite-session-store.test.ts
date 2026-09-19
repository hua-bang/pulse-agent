import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageError } from '@pulse-coder/storage';
import { SessionStore } from './session-store';
import { activateSqliteSessions } from './sqlite-session-migration';
import { closeSqliteSessionStorage, getSqliteSessionStorage } from './sqlite-session-backend';
import { readCanvasAgentHistorySnapshot } from './history-snapshot';
import { reconcileAgentWithStoredSession } from './session-display-loader';
import type { CanvasAgentMessage } from './types';

let root: string;
let originalRoot: string | undefined;
const message = (content: string, timestamp = 1): CanvasAgentMessage => ({ role: 'user', content, timestamp });

beforeEach(async () => {
  originalRoot = process.env.PULSE_CANVAS_SESSION_STORE_DIR;
  root = await mkdtemp(join(tmpdir(), 'canvas-sqlite-session-'));
  process.env.PULSE_CANVAS_SESSION_STORE_DIR = root;
  await activateSqliteSessions(root);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeSqliteSessionStorage();
  if (originalRoot === undefined) delete process.env.PULSE_CANVAS_SESSION_STORE_DIR;
  else process.env.PULSE_CANVAS_SESSION_STORE_DIR = originalRoot;
  await rm(root, { recursive: true, force: true });
});

describe('SessionStore with the SQLite strategy', () => {
  it('does not refresh an old runtime baseline over an external message append', async () => {
    const store = new SessionStore('ws');
    await store.startSession();
    store.addMessage(message('baseline'));
    const id = store.getCurrentSession()!.sessionId;
    await store.readSession(id);
    const storage = (await getSqliteSessionStorage(root))!;
    const previous = (await storage.conversations.read('ws', id))!;
    await storage.conversations.commit({
      scopeId: 'ws', sessionId: id, expectedRevision: previous.revision,
      appendMessages: [{ id: 'external-message', role: 'user', content: 'external append', timestamp: 2 }],
    });
    await expect(reconcileAgentWithStoredSession({ kind: 'workspace', workspaceId: 'ws' }, {
      getCurrentSessionId: () => store.getCurrentSession()?.sessionId ?? null,
      loadSession: sessionId => store.loadSession(sessionId),
      readSessionById: (sessionId, refreshIfClean) => store.readSession(sessionId, refreshIfClean),
    })).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(store.getMessages().map(item => item.content)).toEqual(['baseline']);
    await expect(store.replaceMessagesInSession(id, [...store.getMessages(), message('stale runtime turn', 3)]))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    expect((await storage.conversations.read('ws', id))?.messages.map(item => item.content))
      .toEqual(['baseline', 'external append']);
  });

  it('refuses to adopt a new stored revision over an unsaved current-session draft', async () => {
    const storage = (await getSqliteSessionStorage(root))!;
    await storage.canvas.commit({ workspaceId: 'ws', expectedRevision: null });
    const store = new SessionStore('ws');
    await store.startSession();
    store.addMessage(message('baseline'));
    const id = store.getCurrentSession()!.sessionId;
    await store.readSession(id);
    const bundle = (await storage.workspaces.readBundle('ws'))!;
    const trashed = await storage.workspaces.trashBundle({
      workspaceId: 'ws', expectedCanvasRevision: bundle.canvas.revision,
      generation: bundle.canvas.generation, expectedConversations: bundle.conversationState,
    });
    await storage.workspaces.restoreBundle('ws', trashed.revision, trashed.generation);
    store.getMessages().push(message('unsaved draft', 2));
    await expect(store.readSession(id, true)).rejects.toMatchObject({ code: 'storage_busy' });
    expect(store.getMessages().map(item => item.content)).toEqual(['baseline', 'unsaved draft']);
    await expect(store.appendToSession(id, [message('later', 3)])).rejects.toMatchObject({ code: 'revision_conflict' });
    expect((await storage.conversations.read('ws', id))?.messages.map(item => item.content)).toEqual(['baseline']);
  });

  it('does not adopt or clear a pending save while reconciling the same session', async () => {
    const store = new SessionStore('ws');
    await store.startSession();
    const id = store.getCurrentSession()!.sessionId;
    const storage = (await getSqliteSessionStorage(root))!;
    const commit = storage.conversations.commit.bind(storage.conversations);
    let finish!: () => void;
    const pending = new Promise<void>(resolve => { finish = resolve; });
    vi.spyOn(storage.conversations, 'commit').mockImplementationOnce(async input => {
      await pending;
      return commit(input);
    });
    store.addMessage(message('pending draft'));
    await expect(store.readSession(id, true)).rejects.toMatchObject({ code: 'storage_busy' });
    expect(store.getMessages().map(item => item.content)).toEqual(['pending draft']);
    finish();
    expect((await store.readSession(id))?.messages.map(item => item.content)).toEqual(['pending draft']);
  });

  it('continues a cached session after trash and restore without an intermediate read', async () => {
    const storage = (await getSqliteSessionStorage(root))!;
    await storage.canvas.commit({ workspaceId: 'ws', expectedRevision: null });
    const store = new SessionStore('ws');
    await store.startSession();
    store.addMessage(message('preserved history'));
    const id = store.getCurrentSession()!.sessionId;
    await store.readSession(id);
    const bundle = (await storage.workspaces.readBundle('ws'))!;
    const trashed = await storage.workspaces.trashBundle({
      workspaceId: 'ws', expectedCanvasRevision: bundle.canvas.revision,
      generation: bundle.canvas.generation, expectedConversations: bundle.conversationState,
    });
    await storage.workspaces.restoreBundle('ws', trashed.revision, trashed.generation);
    await reconcileAgentWithStoredSession({ kind: 'workspace', workspaceId: 'ws' }, {
      getCurrentSessionId: () => store.getCurrentSession()?.sessionId ?? null,
      loadSession: sessionId => store.loadSession(sessionId),
      readSessionById: (sessionId, refreshIfClean) => store.readSession(sessionId, refreshIfClean),
    });
    await expect(store.appendToSession(id, [message('continued after restore', 2)])).resolves.toBeUndefined();
    expect((await store.readSession(id))?.messages.map(item => item.content))
      .toEqual(['preserved history', 'continued after restore']);
  });

  it('hides a cached session after external workspace trash and cannot recreate or rewrite it', async () => {
    const storage = (await getSqliteSessionStorage(root))!;
    await storage.canvas.commit({ workspaceId: 'ws', expectedRevision: null });
    const store = new SessionStore('ws');
    await store.startSession();
    store.addMessage(message('preserved history'));
    const id = store.getCurrentSession()!.sessionId;
    await store.readSession(id);
    const bundle = (await storage.workspaces.readBundle('ws'))!;
    const trashed = await storage.workspaces.trashBundle({
      workspaceId: 'ws', expectedCanvasRevision: bundle.canvas.revision,
      generation: bundle.canvas.generation, expectedConversations: bundle.conversationState,
    });
    expect(await store.readSession(id)).toBeNull();
    expect(store.getCurrentSession()).toBeNull();
    expect(store.getMessages()).toEqual([]);
    await expect(store.startSession()).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.appendToSession(id, [message('must not reappear')])).rejects.toMatchObject({ code: 'not_found' });
    expect(await storage.conversationScopes.read('ws')).toBeNull();
    await storage.workspaces.restoreBundle('ws', trashed.revision, trashed.generation);
    expect((await new SessionStore('ws').restoreCurrentSession())?.messages.map(item => item.content))
      .toEqual(['preserved history']);
  });

  it('measures only committed incremental JSON bytes and excludes failed or unchanged writes', async () => {
    const previousPerfFlag = process.env.PULSE_CANVAS_PERF;
    process.env.PULSE_CANVAS_PERF = '1';
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const store = new SessionStore('ws');
      await store.startSession();
      const id = store.getCurrentSession()!.sessionId;
      store.setMessages([message('历史'.repeat(2000))]);
      await store.readSession(id);
      log.mockClear();
      const storage = (await getSqliteSessionStorage(root))!;
      const commit = vi.spyOn(storage.conversations, 'commit');
      store.addMessage(message('new', 2));
      await store.readSession(id);
      const input = commit.mock.calls[0][0];
      expect(input.appendMessages).toHaveLength(1);
      expect(input.replaceMessages).toBeUndefined();
      expect(log).toHaveBeenCalledOnce();
      const bytes = JSON.parse(String(log.mock.calls[0][0]).slice('[perf] session-persist '.length)).bytes;
      expect(bytes).toBe(Buffer.byteLength(JSON.stringify(input.metadata)) + Buffer.byteLength(JSON.stringify(input.appendMessages![0])));
      expect(bytes).toBeLessThan(Buffer.byteLength(JSON.stringify(store.getMessages())) / 2);
      log.mockClear();
      await store.replaceMessagesInSession(id, store.getMessages());
      expect(log).not.toHaveBeenCalled();
      commit.mockRejectedValueOnce(new StorageError('storage_busy', 'write did not commit'));
      await expect(store.replaceMessagesInSession(id, [...store.getMessages(), message('failed', 3)]))
        .rejects.toThrow('write did not commit');
      expect(log).not.toHaveBeenCalled();
    } finally {
      if (previousPerfFlag === undefined) delete process.env.PULSE_CANVAS_PERF;
      else process.env.PULSE_CANVAS_PERF = previousPerfFlag;
    }
  });

  it('keeps empty drafts reusable and performs real incremental appends with stable message IDs', async () => {
    const store = new SessionStore('ws');
    await store.startSession();
    const id = store.getCurrentSession()!.sessionId;
    await store.startSession();
    expect(store.getCurrentSession()!.sessionId).toBe(id);
    expect(await store.listSessions()).toEqual([]);
    const storage = (await getSqliteSessionStorage(root))!;
    const commit = vi.spyOn(storage.conversations, 'commit');
    const first = message('first');
    store.addMessage(first);
    const persisted = (await store.readSession(id))!;
    await store.replaceMessagesInSession(id, [...persisted.messages, message('second', 2)]);
    const saved = (await storage.conversations.read('ws', id))!;
    expect(saved.messages).toHaveLength(2);
    expect(first).toHaveProperty('id', saved.messages[0].id);
    expect(commit.mock.calls.map(([input]) => input.appendMessages?.length)).toEqual([1, 1]);
    expect(commit.mock.calls.every(([input]) => input.replaceMessages === undefined)).toBe(true);
    store.truncateMessages(1);
    await store.readSession(id);
    expect(commit.mock.calls.at(-1)?.[0].replaceMessages).toHaveLength(1);
    store.addMessage(message('replacement tail', 3));
    await store.readSession(id);
    const edited = (await storage.conversations.read('ws', id))!;
    expect(edited.messages[0].id).toBe(saved.messages[0].id);
    expect(edited.messages[1].id).not.toBe(saved.messages[1].id);
    await expect(stat(join(root, 'ws', 'agent-sessions', 'current.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves source history when branching, editing, and appending to archived sessions', async () => {
    const store = new SessionStore('ws');
    await store.startSession();
    const sourceId = store.getCurrentSession()!.sessionId;
    store.setMessages([message('one'), message('two', 2), message('three', 3)]);
    const source = (await store.readSession(sourceId))!;
    const branch = (await store.branchSession(2))!;
    expect(branch.sourceSessionId).toBe(sourceId);
    expect(branch.session.messages).toEqual(source.messages.slice(0, 2));
    expect((await store.readSession(sourceId))!.messages).toEqual(source.messages);
    await store.appendToSession(sourceId, [message('archived append', 4)]);
    expect(await SessionStore.readCurrentSessionId('ws')).toBe(branch.session.sessionId);
    expect(store.getCurrentSession()!.sessionId).toBe(branch.session.sessionId);
    const old = (await store.readSession(sourceId))!;
    await store.replaceMessagesInSession(sourceId, [{ ...old.messages[0], content: 'edited old turn' }]);
    expect((await store.readSession(sourceId))!.messages.map(entry => entry.content)).toEqual(['edited old turn']);
    expect((await store.readSession(branch.session.sessionId))!.messages).toEqual(source.messages.slice(0, 2));
    await store.loadSession(sourceId);
    expect(await SessionStore.readCurrentSessionId('ws')).toBe(sourceId);
  });

  it('persists title/pin metadata, lists without reading messages, and serves cold/static lookups from SQL', async () => {
    const store = new SessionStore('ws');
    await store.startSession();
    const id = store.getCurrentSession()!.sessionId;
    store.addMessage(message('prompt', 42));
    await store.renameSession(id, 'Decision');
    await store.setSessionPinned(id, true);
    await writeFile(join(root, '__workspaces__.json'), JSON.stringify({ workspaces: [{ id: 'ws', name: 'Workspace' }] }));
    const storage = (await getSqliteSessionStorage(root))!;
    const read = vi.spyOn(storage.conversations, 'read');
    expect(await store.listSessions()).toMatchObject([{ sessionId: id, title: 'Decision', pinned: true, updatedAt: 42 }]);
    expect(await SessionStore.listAllWorkspaceSessions()).toMatchObject([{ workspaceId: 'ws', sessions: [{ sessionId: id, pinned: true }] }]);
    expect(read).not.toHaveBeenCalled();
    expect((await SessionStore.readSessionFromWorkspace('ws', id))?.messages[0].content).toBe('prompt');
    expect(await SessionStore.readAllSessionsWithMeta()).toMatchObject([{ workspaceName: 'Workspace', isCurrent: true, session: { sessionId: id } }]);
    const history = await readCanvasAgentHistorySnapshot({ kind: 'workspace', workspaceId: 'ws' }, undefined);
    expect(history).toMatchObject({ activeSessionId: id, messages: [{ content: 'prompt' }] });
    expect(await readFile(join(root, '__storage__.json'), 'utf8')).toContain('conversations');
  });

  it('keeps archive peeks pointer-neutral and deletes current sessions together with a replacement draft', async () => {
    const store = new SessionStore('ws');
    await store.startSession();
    const archivedId = store.getCurrentSession()!.sessionId;
    store.addMessage(message('history'));
    await store.startSession();
    const draftId = store.getCurrentSession()!.sessionId;
    const cold = new SessionStore('ws');
    expect((await cold.restoreLastSession())?.sessionId).toBe(archivedId);
    expect(await SessionStore.readCurrentSessionId('ws')).toBe(draftId);
    await store.loadSession(archivedId);
    const removed = (await store.deleteSession(archivedId))!;
    expect(removed.deletedCurrent).toBe(true);
    expect(removed.activeSession.messages).toEqual([]);
    expect(await SessionStore.readCurrentSessionId('ws')).toBe(removed.activeSession.sessionId);
    expect(await store.readSession(archivedId)).toBeNull();
    await store.archiveSession();
    expect(await SessionStore.readCurrentSessionId('ws')).toBeNull();
  });

  it('leaves pointer and source unchanged when a branch transaction fails', async () => {
    const store = new SessionStore('ws');
    await store.startSession();
    const id = store.getCurrentSession()!.sessionId;
    store.addMessage(message('source'));
    const before = await store.readSession(id);
    const storage = (await getSqliteSessionStorage(root))!;
    vi.spyOn(storage.conversationScopes, 'commit').mockRejectedValueOnce(new Error('disk full'));
    await expect(store.branchSession(1)).rejects.toThrow('disk full');
    expect(store.getCurrentSession()!.sessionId).toBe(id);
    expect(await SessionStore.readCurrentSessionId('ws')).toBe(id);
    expect(await store.readSession(id)).toEqual(before);
  });

  it('can delete the durable empty draft even when a cold reader is peeking archived history', async () => {
    const store = new SessionStore('ws');
    await store.startSession();
    const archivedId = store.getCurrentSession()!.sessionId;
    store.addMessage(message('history'));
    await store.startSession();
    const draftId = store.getCurrentSession()!.sessionId;
    const cold = new SessionStore('ws');
    await cold.restoreLastSession();
    expect(cold.getCurrentSession()!.sessionId).toBe(archivedId);
    const result = (await cold.deleteSession(draftId))!;
    expect(result.deletedCurrent).toBe(true);
    expect(await SessionStore.readCurrentSessionId('ws')).toBe(result.activeSession.sessionId);
    expect((await cold.readSession(archivedId))?.messages[0].content).toBe('history');
  });

  it('surfaces queued failures before pointer changes and recovers a transient failed append', async () => {
    const store = new SessionStore('ws');
    await store.startSession();
    const id = store.getCurrentSession()!.sessionId;
    const storage = (await getSqliteSessionStorage(root))!;
    vi.spyOn(storage.conversations, 'commit').mockRejectedValueOnce(new StorageError('storage_busy', 'busy fixture'));
    store.addMessage(message('must be recovered'));
    await expect(store.startSession()).rejects.toThrow('busy fixture');
    expect(await SessionStore.readCurrentSessionId('ws')).toBe(id);
    expect((await store.readSession(id))?.messages.map(entry => entry.content)).toEqual(['must be recovered']);
    await store.startSession();
    expect(store.getCurrentSession()!.sessionId).not.toBe(id);
  });

  it('rejects stale writes without overwriting newer conversation content', async () => {
    const store = new SessionStore('ws');
    await store.startSession();
    const id = store.getCurrentSession()!.sessionId;
    const storage = (await getSqliteSessionStorage(root))!;
    await storage.conversations.commit({
      scopeId: 'ws', sessionId: id, expectedRevision: 1, expectedGeneration: storage.generation,
      appendMessages: [{ id: 'external', role: 'user', content: 'newer writer', timestamp: 1 }],
    });
    store.addMessage(message('stale writer'));
    await expect(store.readSession(id)).rejects.toMatchObject({ code: 'revision_conflict' });
    expect((await storage.conversations.read('ws', id))?.messages.map(entry => entry.content)).toEqual(['newer writer']);
    expect((await store.restoreCurrentSession())?.messages.map(entry => entry.content)).toEqual(['newer writer']);
  });

  it('requires explicit creation and never resurrects a missing conversation through append or replacement', async () => {
    const store = new SessionStore('ws');
    await store.startSession();
    const currentId = store.getCurrentSession()!.sessionId;
    await expect(store.appendToSession('missing', [message('late')])).rejects.toMatchObject({ code: 'not_found' });
    await expect(store.replaceMessagesInSession('missing', [message('late')])).rejects.toMatchObject({ code: 'not_found' });
    expect(await store.readSession('missing')).toBeNull();
    await store.createConversationById('provisioned', [message('explicit copy')]);
    expect(await SessionStore.readCurrentSessionId('ws')).toBe(currentId);
    expect((await store.readSession('provisioned'))?.messages[0].content).toBe('explicit copy');
    await expect(store.createConversationById('provisioned', [])).rejects.toMatchObject({ code: 'revision_conflict' });
  });

  it('isolates global, scheduled, workspace and hidden scope histories in rail and history lookups', async () => {
    for (const [id, scope] of [
      ['ws', { kind: 'workspace', workspaceId: 'ws' }],
      ['__global_chat__', { kind: 'global' }],
      ['__scheduled__-job', { kind: 'scheduled', taskId: 'job' }],
      ['__channel_private__', { kind: 'workspace', workspaceId: '__channel_private__' }],
    ] as const) {
      const store = new SessionStore(id, scope);
      await store.startSession();
      store.addMessage(message(id));
      await store.readSession(store.getCurrentSession()!.sessionId);
    }
    expect((await SessionStore.listAllWorkspaceSessions(new Set(), new Set(['ws']))).map(group => group.workspaceId).sort())
      .toEqual(['__global_chat__', '__scheduled__-job', 'ws'].sort());
    expect((await SessionStore.readAllSessionsWithMeta()).map(entry => entry.session.workspaceId).sort())
      .toEqual(['__global_chat__', '__scheduled__-job', 'ws'].sort());
  });
});
