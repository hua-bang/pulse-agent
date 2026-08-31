import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionStore } from '../session-store';
import { scheduledSessionStoreId } from '../../../shared/agent-chat';
import type { CanvasAgentMessage } from '../types';
import { peekLastSession } from '../history-snapshot';

const makeMessage = (index: number): CanvasAgentMessage => ({
  role: index % 2 === 0 ? 'user' : 'assistant',
  content: `message ${index}`,
  timestamp: Date.now(),
});

describe('SessionStore', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `session-store-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    process.env.PULSE_CANVAS_SESSION_STORE_DIR = root;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    delete process.env.PULSE_CANVAS_SESSION_STORE_DIR;
    await fs.rm(root, { recursive: true, force: true });
  });

  it('reuses an empty current draft and keeps it out of history', async () => {
    const store = new SessionStore('ws-empty-draft');

    await store.startSession();
    const firstSessionId = store.getCurrentSession()?.sessionId;
    expect(await store.listSessions()).toEqual([]);

    await store.startSession();

    expect(store.getCurrentSession()?.sessionId).toBe(firstSessionId);
    expect(await store.listSessions()).toEqual([]);
    expect(await store.listArchivedSessions()).toEqual([]);
  });

  it('reads an archived session without moving the current pointer', async () => {
    const store = new SessionStore('ws-read-session');
    await store.startSession();
    const currentId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.startSession();
    const archivedId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(1));
    await store.startSession();
    const newestId = store.getCurrentSession()!.sessionId;

    const archived = await store.readSession(archivedId);
    const current = await store.readSession(currentId);

    expect(archived?.sessionId).toBe(archivedId);
    expect(archived?.messages.map(m => m.content)).toEqual(['message 1']);
    expect(current?.sessionId).toBe(currentId);
    expect(current?.messages.map(m => m.content)).toEqual(['message 0']);
    // Pointer is untouched: the newest session stays current.
    expect(store.getCurrentSession()?.sessionId).toBe(newestId);
    expect(await store.readSession('missing-session')).toBeNull();
  });

  it('peeks the useful archived session without promoting it over an empty draft', async () => {
    const storeId = 'ws-peek-last';
    const store = new SessionStore(storeId);
    await store.startSession();
    const archivedId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.startSession();
    const emptyCurrentId = store.getCurrentSession()!.sessionId;

    const reader = new SessionStore(storeId);
    const peeked = await peekLastSession(reader);

    expect(peeked?.sessionId).toBe(archivedId);
    expect(peeked?.messages.map(message => message.content)).toEqual(['message 0']);
    expect(await SessionStore.readCurrentSessionId(storeId)).toBe(emptyCurrentId);
  });

  it('appends to the current session through the fast path', async () => {
    const store = new SessionStore('ws-append-current');
    await store.startSession();
    const sessionId = store.getCurrentSession()!.sessionId;

    await store.appendToSession(sessionId, [makeMessage(0), makeMessage(1)]);

    expect(store.getMessages().map(m => m.content)).toEqual(['message 0', 'message 1']);
    const reloaded = await store.readSession(sessionId);
    expect(reloaded?.messages.map(m => m.content)).toEqual(['message 0', 'message 1']);
  });

  it('appends to an archived session and persists to its newest copy', async () => {
    const store = new SessionStore('ws-append-archived');
    await store.startSession();
    const archivedId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.startSession();
    const liveId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(1));

    // The run is anchored to the archived conversation while the pointer
    // lives on another session.
    await store.appendToSession(archivedId, [makeMessage(2)]);

    const archived = await store.readSession(archivedId);
    expect(archived?.sessionId).toBe(archivedId);
    expect(archived?.messages.map(m => m.content)).toEqual(['message 0', 'message 2']);
    // The live pointer session is untouched.
    expect(store.getCurrentSession()?.sessionId).toBe(liveId);
    expect(store.getMessages().map(m => m.content)).toEqual(['message 1']);
  });

  it('replaces current or archived conversation messages without moving the pointer', async () => {
    const store = new SessionStore('ws-replace-session');
    await store.startSession();
    const archivedId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.startSession();
    const currentId = store.getCurrentSession()!.sessionId;

    await store.replaceMessagesInSession(archivedId, [makeMessage(2)]);
    await store.replaceMessagesInSession(currentId, [makeMessage(3)]);

    expect((await store.readSession(archivedId))?.messages.map(m => m.content))
      .toEqual(['message 2']);
    expect((await store.readSession(currentId))?.messages.map(m => m.content))
      .toEqual(['message 3']);
    expect(store.getCurrentSession()?.sessionId).toBe(currentId);
  });

  it('drops appends for a session that no longer exists', async () => {
    const store = new SessionStore('ws-append-missing');
    await store.startSession();

    await expect(store.appendToSession('does-not-exist', [makeMessage(0)])).resolves.toBeUndefined();
    expect(store.getMessages()).toEqual([]);
  });

  it('materializes an anchored-but-unpersisted draft instead of dropping messages', async () => {
    const store = new SessionStore('ws-append-draft');
    await store.startSession();
    const liveId = store.getCurrentSession()!.sessionId;
    // A run anchored to a conversation the UI created but never persisted
    // (no current/archive file for it). Messages must not be lost.
    const draftId = 'session-draft-not-on-disk';
    await store.appendToSession(draftId, [makeMessage(0)]);

    const materialized = await store.readSession(draftId);
    expect(materialized?.sessionId).toBe(draftId);
    expect(materialized?.messages.map(m => m.content)).toEqual(['message 0']);
    // Pointer untouched — the live session stays current.
    expect(store.getCurrentSession()?.sessionId).toBe(liveId);
  });

  it('keeps archived history visible beside an empty current draft', async () => {
    const store = new SessionStore('ws-empty-current-with-history');
    await store.startSession();
    const archivedSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.startSession();

    const sessions = await SessionStore.readAllSessionsWithMeta();

    expect(sessions.map(entry => entry.session.sessionId)).toContain(archivedSessionId);
    expect(sessions.some(entry => entry.session.messages.length === 0)).toBe(false);
  });

  it('persists many concurrent addMessage calls without racing the temp-file rename', async () => {
    const store = new SessionStore('ws-1');
    await store.startSession();

    // Fire every addMessage synchronously back-to-back (mirrors the old
    // loadCrossWorkspaceSession loop) — without the persistQueue,
    // overlapping writeFile calls to current.json raced and the final file
    // could end up with an earlier (smaller) snapshot than the last call.
    const messages = Array.from({ length: 60 }, (_, i) => makeMessage(i));
    for (const message of messages) {
      store.addMessage(message);
    }

    // Wait for the queued chain to drain by issuing one more persist-backed
    // call and reading the state back from a fresh store instance.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const reloaded = new SessionStore('ws-1');
    const session = await reloaded.loadSession(store.getCurrentSession()!.sessionId);
    expect(session?.messages.map((m) => m.content)).toEqual(messages.map((m) => m.content));

    const sessionsDir = join(root, 'ws-1', 'agent-sessions');
    const entries = await fs.readdir(sessionsDir);
    expect(entries.filter((name) => name.includes('.tmp'))).toEqual([]);
  });

  it('rejects a pointer change after a queued current write fails, then lets a later write recover', async () => {
    const store = new SessionStore('ws-queued-write-failure');
    await store.startSession();
    const sourceSessionId = store.getCurrentSession()!.sessionId;
    const rename = vi.spyOn(fs, 'rename');
    rename.mockRejectedValueOnce(new Error('queued current write failed'));

    store.addMessage(makeMessage(0));

    await expect(store.startSession()).rejects.toThrow('queued current write failed');
    expect(store.getCurrentSession()?.sessionId).toBe(sourceSessionId);

    // The failed write must not poison the serialization tail. The rejected
    // pointer action repairs the old current snapshot before returning, so a
    // deliberate retry can proceed without requiring another message edit.
    await store.startSession();

    expect(store.getCurrentSession()?.sessionId).not.toBe(sourceSessionId);
    const source = await SessionStore.readSessionFromWorkspace(
      'ws-queued-write-failure',
      sourceSessionId,
    );
    expect(source?.messages.map(message => message.content)).toEqual(['message 0']);
  });

  it('reports an unobserved queued failure even when a later snapshot succeeds', async () => {
    const store = new SessionStore('ws-sticky-write-failure');
    await store.startSession();
    const sourceSessionId = store.getCurrentSession()!.sessionId;
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('first queued write failed'));

    store.addMessage(makeMessage(0));
    store.addMessage(makeMessage(1));

    await expect(store.startSession()).rejects.toThrow('first queued write failed');
    expect(store.getCurrentSession()?.sessionId).toBe(sourceSessionId);

    await store.startSession();
    const source = await SessionStore.readSessionFromWorkspace(
      'ws-sticky-write-failure',
      sourceSessionId,
    );
    expect(source?.messages.map(message => message.content))
      .toEqual(['message 0', 'message 1']);
  });

  it('keeps the current pointer intact when publishing its archive fails', async () => {
    const workspaceId = 'ws-archive-failure';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sourceSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.renameSession(sourceSessionId, 'Source session');

    const archiveDir = join(root, workspaceId, 'agent-sessions', 'archive');
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to).startsWith(archiveDir)) {
        throw new Error('archive publish failed');
      }
      return realRename(from, to);
    });

    await expect(store.startSession()).rejects.toThrow('archive publish failed');
    expect(store.getCurrentSession()?.sessionId).toBe(sourceSessionId);

    const reloaded = new SessionStore(workspaceId);
    const current = await reloaded.restoreCurrentSession();
    expect(current?.sessionId).toBe(sourceSessionId);
    expect(current?.messages.map(message => message.content)).toEqual(['message 0']);
    expect((await fs.readdir(archiveDir)).filter(file => file.includes('.tmp'))).toEqual([]);
  });

  it('keeps the source current when persisting a replacement pointer fails', async () => {
    const workspaceId = 'ws-replacement-failure';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sourceSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.renameSession(sourceSessionId, 'Source session');

    const currentPath = join(root, workspaceId, 'agent-sessions', 'current.json');
    const realRename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === currentPath) {
        throw new Error('replacement current publish failed');
      }
      return realRename(from, to);
    });

    await expect(store.branchSession(1)).rejects.toThrow('replacement current publish failed');
    expect(store.getCurrentSession()?.sessionId).toBe(sourceSessionId);

    const reloaded = new SessionStore(workspaceId);
    const current = await reloaded.restoreCurrentSession();
    expect(current?.sessionId).toBe(sourceSessionId);
    expect(current?.messages.map(message => message.content)).toEqual(['message 0']);
  });

  it('treats a corrupted current file as an error instead of no current session', async () => {
    const workspaceId = 'ws-corrupt-current';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sourceSessionId = store.getCurrentSession()!.sessionId;
    const currentPath = join(root, workspaceId, 'agent-sessions', 'current.json');
    await fs.writeFile(currentPath, '{invalid json', 'utf-8');

    const reloaded = new SessionStore(workspaceId);
    await expect(reloaded.restoreCurrentSession()).rejects.toThrow('Current session is corrupted');
    expect(reloaded.getCurrentSession()).toBeNull();

    await expect(store.startSession()).rejects.toThrow('Current session is corrupted');
    expect(store.getCurrentSession()?.sessionId).toBe(sourceSessionId);
    expect(await fs.readFile(currentPath, 'utf-8')).toBe('{invalid json');
  });

  it('preserves every archived session when pointer changes share one timestamp', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    const workspaceId = 'ws-archive-collision';
    const store = new SessionStore(workspaceId);

    await store.startSession();
    const firstSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.startSession();

    const secondSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(2));
    await store.startSession();

    const archivedIds = (await store.listArchivedSessions())
      .map(session => session.sessionId)
      .sort();
    expect(archivedIds).toEqual([firstSessionId, secondSessionId].sort());
  });

  it('keeps a promoted session active when old archive cleanup fails', async () => {
    const workspaceId = 'ws-promotion-cleanup-failure';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const promotedSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.startSession();
    const archiveDir = join(root, workspaceId, 'agent-sessions', 'archive');
    const realUnlink = fs.unlink.bind(fs);
    vi.spyOn(fs, 'unlink').mockImplementation(async (path) => {
      if (String(path).startsWith(archiveDir)) throw new Error('cleanup denied');
      return realUnlink(path);
    });

    await expect(store.loadSession(promotedSessionId))
      .resolves.toMatchObject({ sessionId: promotedSessionId });
    expect(store.getCurrentSession()?.sessionId).toBe(promotedSessionId);
    const reloaded = new SessionStore(workspaceId);
    expect((await reloaded.restoreCurrentSession())?.sessionId).toBe(promotedSessionId);
  });

  it('reads each archive only once while promoting and cleaning a session', async () => {
    const workspaceId = 'ws-single-promotion-scan';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const promotedSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.startSession();
    store.addMessage(makeMessage(1));
    await store.startSession();
    const archiveDir = join(root, workspaceId, 'agent-sessions', 'archive');
    const archiveFiles = await fs.readdir(archiveDir);
    const readFile = vi.spyOn(fs, 'readFile');

    await new SessionStore(workspaceId).loadSession(promotedSessionId);

    const archiveReads = readFile.mock.calls
      .map(([path]) => String(path))
      .filter(path => path.startsWith(archiveDir));
    expect(archiveReads).toHaveLength(archiveFiles.length);
    expect(new Set(archiveReads).size).toBe(archiveFiles.length);
  });

  it('promotes the newest duplicate archive and removes every matching copy', async () => {
    const workspaceId = 'ws-newest-duplicate';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sessionId = store.getCurrentSession()!.sessionId;
    store.addMessage({ role: 'user', content: 'older copy', timestamp: 1 });
    await store.startSession();
    const archiveDir = join(root, workspaceId, 'agent-sessions', 'archive');
    const [olderFile] = await fs.readdir(archiveDir);
    const olderPath = join(archiveDir, olderFile);
    const newerPath = join(archiveDir, 'newer-duplicate.json');
    const newer = JSON.parse(await fs.readFile(olderPath, 'utf-8'));
    newer.messages[0].content = 'newer copy';
    await fs.writeFile(newerPath, JSON.stringify(newer), 'utf-8');
    await fs.utimes(olderPath, new Date(1_000), new Date(1_000));
    await fs.utimes(newerPath, new Date(2_000), new Date(2_000));

    const promoted = await new SessionStore(workspaceId).loadSession(sessionId);

    expect(promoted?.messages[0]?.content).toBe('newer copy');
    expect(await fs.readdir(archiveDir)).toEqual([]);
  });

  it('setMessages persists once instead of once per message', async () => {
    const store = new SessionStore('ws-2');
    await store.startSession();
    const messages = Array.from({ length: 10 }, (_, i) => makeMessage(i));

    store.setMessages(messages);
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(store.getMessages().map((m) => m.content)).toEqual(messages.map((m) => m.content));
    const reloaded = new SessionStore('ws-2');
    const session = await reloaded.loadSession(store.getCurrentSession()!.sessionId);
    expect(session?.messages.map((m) => m.content)).toEqual(messages.map((m) => m.content));
  });

  it('restores the persisted current session without archiving it', async () => {
    const store = new SessionStore('ws-restore');
    await store.startSession();
    const sessionId = store.getCurrentSession()!.sessionId;
    const messages = [makeMessage(0), makeMessage(1)];

    store.setMessages(messages);
    await new Promise((resolve) => setTimeout(resolve, 100));

    const reloaded = new SessionStore('ws-restore');
    const restored = await reloaded.restoreCurrentSession();

    expect(restored?.sessionId).toBe(sessionId);
    expect(restored?.messages.map((m) => m.content)).toEqual(messages.map((m) => m.content));
    expect(reloaded.getCurrentSession()?.sessionId).toBe(sessionId);
    expect(await reloaded.listArchivedSessions()).toEqual([]);
  });

  it('restores the newest archived session when current is empty', async () => {
    const store = new SessionStore('ws-restore-archive');
    await store.startSession();
    const firstSessionId = store.getCurrentSession()!.sessionId;
    const messages = [makeMessage(0), makeMessage(1)];

    store.setMessages(messages);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await store.startSession();
    expect(store.getCurrentSession()!.messages).toEqual([]);

    const reloaded = new SessionStore('ws-restore-archive');
    const restored = await reloaded.restoreLastSession();

    expect(restored?.sessionId).toBe(firstSessionId);
    expect(restored?.messages.map((m) => m.content)).toEqual(messages.map((m) => m.content));
    expect(reloaded.getCurrentSession()?.sessionId).toBe(firstSessionId);
    expect((await reloaded.listSessions()).map(session => session.sessionId)).toEqual([firstSessionId]);
  });

  it('archiveCurrentIfExists waits for in-flight writes before archiving', async () => {
    const store = new SessionStore('ws-3');
    await store.startSession();
    const firstSessionId = store.getCurrentSession()!.sessionId;

    // Fire a message add (fire-and-forget persist queued) and immediately
    // start a new session — startSession's archiveCurrentIfExists must wait
    // for that queued write, or the just-started fresh session's file could
    // be clobbered by the outgoing session's late write.
    store.addMessage(makeMessage(0));
    await store.startSession();
    const secondSessionId = store.getCurrentSession()!.sessionId;
    expect(secondSessionId).not.toBe(firstSessionId);

    await new Promise((resolve) => setTimeout(resolve, 200));

    const reloaded = new SessionStore('ws-3');
    const current = await reloaded.loadSession(secondSessionId);
    expect(current?.sessionId).toBe(secondSessionId);
    expect(current?.messages).toEqual([]);

    const archived = await reloaded.listArchivedSessions();
    expect(archived.some((s) => s.sessionId === firstSessionId)).toBe(true);
  });

  it('branches the current session without changing the source conversation', async () => {
    const store = new SessionStore('ws-branch');
    await store.startSession();
    const sourceSessionId = store.getCurrentSession()!.sessionId;
    const sourceMessages = Array.from({ length: 4 }, (_, index) => makeMessage(index));
    store.setMessages(sourceMessages);

    const branch = await store.branchSession(2);

    expect(branch?.sourceSessionId).toBe(sourceSessionId);
    expect(branch?.session.sessionId).not.toBe(sourceSessionId);
    expect(branch?.session.messages.map((message) => message.content))
      .toEqual(['message 0', 'message 1']);

    const preservedSource = await SessionStore.readSessionFromWorkspace(
      'ws-branch',
      sourceSessionId,
    );
    expect(preservedSource?.messages.map((message) => message.content))
      .toEqual(['message 0', 'message 1', 'message 2', 'message 3']);
  });

  it('persists a renamed session and includes its metadata in later listings', async () => {
    const store = new SessionStore('ws-rename');
    await store.startSession();
    const sessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));

    expect(await store.renameSession(sessionId, 'Decision log')).toBe(true);
    await store.startSession();

    const reloaded = new SessionStore('ws-rename');
    const listed = (await reloaded.listArchivedSessions())
      .find((session) => session.sessionId === sessionId);
    expect(listed).toMatchObject({
      title: 'Decision log',
      pinned: false,
    });
  });

  it('uses the exact message time for recency even when a copied archive has a newer mtime', async () => {
    const workspaceId = 'ws-recency';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sessionId = store.getCurrentSession()!.sessionId;
    const exactUpdatedAt = Date.now() + 60_000;
    store.addMessage({ role: 'user', content: 'first', timestamp: exactUpdatedAt });
    await store.startSession();

    const archiveDir = join(root, workspaceId, 'agent-sessions', 'archive');
    const [archiveFile] = await fs.readdir(archiveDir);
    const copiedAt = exactUpdatedAt + 60_000;
    await fs.utimes(
      join(archiveDir, archiveFile),
      new Date(copiedAt),
      new Date(copiedAt),
    );

    const listed = (await new SessionStore(workspaceId).listArchivedSessions())
      .find((session) => session.sessionId === sessionId);
    expect(listed?.updatedAt).toBe(exactUpdatedAt);
  });

  it('persists pin and unpin state for an archived session', async () => {
    const store = new SessionStore('ws-pin');
    await store.startSession();
    const sessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.startSession();

    expect(await store.setSessionPinned(sessionId, true)).toBe(true);
    const pinned = (await new SessionStore('ws-pin').listArchivedSessions())
      .find((session) => session.sessionId === sessionId);
    expect(pinned?.pinned).toBe(true);

    expect(await store.setSessionPinned(sessionId, false)).toBe(true);
    const unpinned = (await new SessionStore('ws-pin').listArchivedSessions())
      .find((session) => session.sessionId === sessionId);
    expect(unpinned?.pinned).toBe(false);
  });

  it('deleting the current session creates a safe new active session', async () => {
    const store = new SessionStore('ws-delete-current');
    await store.startSession();
    const deletedSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));

    const result = await store.deleteSession(deletedSessionId);

    expect(result?.deletedCurrent).toBe(true);
    expect(result?.activeSession.sessionId).not.toBe(deletedSessionId);
    expect(result?.activeSession.messages).toEqual([]);
    expect(await SessionStore.readSessionFromWorkspace(
      'ws-delete-current',
      deletedSessionId,
    )).toBeNull();

    const reloaded = new SessionStore('ws-delete-current');
    expect((await reloaded.restoreCurrentSession())?.sessionId)
      .toBe(result?.activeSession.sessionId);
  });

  it('does not delete the current pointer when its replacement cannot be persisted', async () => {
    const workspaceId = 'ws-delete-current-failure';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sourceSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.renameSession(sourceSessionId, 'Source session');

    const currentPath = join(root, workspaceId, 'agent-sessions', 'current.json');
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('delete replacement publish failed'));

    await expect(store.deleteSession(sourceSessionId))
      .rejects.toThrow('delete replacement publish failed');
    expect(store.getCurrentSession()?.sessionId).toBe(sourceSessionId);

    const reloaded = new SessionStore(workspaceId);
    expect((await reloaded.restoreCurrentSession())?.sessionId).toBe(sourceSessionId);
    expect(await fs.readFile(currentPath, 'utf-8')).toContain(sourceSessionId);
  });

  it('does not advance the current pointer when stale archive cleanup blocks deletion', async () => {
    const workspaceId = 'ws-delete-current-stale-archive';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sourceSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.startSession();
    const archiveDir = join(root, workspaceId, 'agent-sessions', 'archive');
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(fs, 'unlink').mockImplementation(async (path) => {
      if (String(path).startsWith(archiveDir)) throw new Error('cleanup denied');
    });

    expect((await store.loadSession(sourceSessionId))?.sessionId).toBe(sourceSessionId);
    await expect(store.deleteSession(sourceSessionId)).rejects.toThrow('cleanup denied');
    expect(store.getCurrentSession()?.sessionId).toBe(sourceSessionId);

    const reloaded = new SessionStore(workspaceId);
    expect((await reloaded.restoreCurrentSession())?.sessionId).toBe(sourceSessionId);
  });

  it('acknowledges a committed current deletion when metadata cleanup fails', async () => {
    const workspaceId = 'ws-delete-current-metadata-failure';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sourceSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.renameSession(sourceSessionId, 'Old title');
    const metadataPath = join(root, workspaceId, 'agent-sessions', 'metadata.json');
    const realRename = fs.rename.bind(fs);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === metadataPath) throw new Error('metadata cleanup denied');
      return realRename(from, to);
    });

    const result = await store.deleteSession(sourceSessionId);

    expect(result?.deletedCurrent).toBe(true);
    expect(result?.activeSession.sessionId).not.toBe(sourceSessionId);
    const reloaded = new SessionStore(workspaceId);
    expect((await reloaded.restoreCurrentSession())?.sessionId)
      .toBe(result?.activeSession.sessionId);
  });

  it('deletes an archived session without changing the current session', async () => {
    const store = new SessionStore('ws-delete-archive');
    await store.startSession();
    const archivedSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.startSession();
    const currentSessionId = store.getCurrentSession()!.sessionId;

    const result = await store.deleteSession(archivedSessionId);

    expect(result).toMatchObject({
      deletedCurrent: false,
      activeSession: { sessionId: currentSessionId },
    });
    expect(await SessionStore.readSessionFromWorkspace(
      'ws-delete-archive',
      archivedSessionId,
    )).toBeNull();
    expect(await store.deleteSession('missing-session')).toBeNull();
    expect(store.getCurrentSession()?.sessionId).toBe(currentSessionId);
  });

  it('does not create a current pointer while rejecting a missing deletion', async () => {
    const store = new SessionStore('ws-delete-missing-empty');

    expect(await store.deleteSession('missing-session')).toBeNull();
    expect(store.getCurrentSession()).toBeNull();
    expect(await store.restoreCurrentSession()).toBeNull();
  });

  it('does not report success when deleting an archived session fails', async () => {
    const workspaceId = 'ws-delete-archive-failure';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const archivedSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.renameSession(archivedSessionId, 'Keep metadata');
    await store.startSession();
    const currentSessionId = store.getCurrentSession()!.sessionId;
    const archiveDir = join(root, workspaceId, 'agent-sessions', 'archive');
    const realUnlink = fs.unlink.bind(fs);
    vi.spyOn(fs, 'unlink').mockImplementation(async (path) => {
      if (String(path).startsWith(archiveDir)) throw new Error('archive is read-only');
      return realUnlink(path);
    });

    await expect(store.deleteSession(archivedSessionId))
      .rejects.toThrow('archive is read-only');
    expect(store.getCurrentSession()?.sessionId).toBe(currentSessionId);
    expect((await store.listArchivedSessions()).find(
      session => session.sessionId === archivedSessionId,
    )?.title).toBe('Keep metadata');
  });

  it('includes persisted title and pin state in cross-workspace listings', async () => {
    const store = new SessionStore('ws-list-metadata');
    await store.startSession();
    const sessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.renameSession(sessionId, 'Pinned decision');
    await store.setSessionPinned(sessionId, true);

    const groups = await SessionStore.listAllWorkspaceSessions();
    const listed = groups
      .find((group) => group.workspaceId === 'ws-list-metadata')
      ?.sessions.find((session) => session.sessionId === sessionId);

    expect(listed).toMatchObject({
      title: 'Pinned decision',
      pinned: true,
      isCurrent: true,
    });
  });

  it('reuses a valid metadata index without rereading session bodies', async () => {
    const workspaceId = 'ws-indexed-list';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    store.addMessage(makeMessage(0));
    await store.startSession();
    store.addMessage(makeMessage(1));
    await store.restoreCurrentSession();

    await SessionStore.listAllWorkspaceSessions();
    const readFile = vi.spyOn(fs, 'readFile');
    await SessionStore.listAllWorkspaceSessions();

    const sessionBodyReads = readFile.mock.calls
      .map(([path]) => String(path))
      .filter(path => path.includes(`${workspaceId}/agent-sessions/`))
      .filter(path => path.endsWith('current.json') || path.includes('/archive/'));
    expect(sessionBodyReads).toEqual([]);
  });

  it('updates the metadata index when the current session is persisted', async () => {
    const workspaceId = 'ws-index-current-update';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    store.addMessage(makeMessage(0));
    await store.restoreCurrentSession();
    await SessionStore.listAllWorkspaceSessions();

    store.addMessage(makeMessage(1));
    await store.restoreCurrentSession();
    const readFile = vi.spyOn(fs, 'readFile');
    const groups = await SessionStore.listAllWorkspaceSessions();

    const listed = groups.find(group => group.workspaceId === workspaceId)?.sessions[0];
    expect(listed?.messageCount).toBe(2);
    const sessionBodyReads = readFile.mock.calls
      .map(([path]) => String(path))
      .filter(path => path.includes(`${workspaceId}/agent-sessions/`))
      .filter(path => path.endsWith('current.json') || path.includes('/archive/'));
    expect(sessionBodyReads).toEqual([]);
  });

  it('updates the metadata index when the current pointer is archived', async () => {
    const workspaceId = 'ws-index-archive-update';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const archivedSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.restoreCurrentSession();
    await SessionStore.listAllWorkspaceSessions();

    await store.startSession();
    const readFile = vi.spyOn(fs, 'readFile');
    const groups = await SessionStore.listAllWorkspaceSessions();

    expect(groups.find(group => group.workspaceId === workspaceId)?.sessions)
      .toEqual([expect.objectContaining({ sessionId: archivedSessionId, isCurrent: false })]);
    const sessionBodyReads = readFile.mock.calls
      .map(([path]) => String(path))
      .filter(path => path.includes(`${workspaceId}/agent-sessions/`))
      .filter(path => path.endsWith('current.json') || path.includes('/archive/'));
    expect(sessionBodyReads).toEqual([]);
  });

  it('uses the metadata index to read only the selected archived body', async () => {
    const workspaceId = 'ws-index-targeted-load';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const selectedSessionId = store.getCurrentSession()!.sessionId;
    for (let index = 0; index < 3; index++) {
      store.addMessage(makeMessage(index));
      await store.startSession();
    }
    await SessionStore.listAllWorkspaceSessions();
    const archiveDir = join(root, workspaceId, 'agent-sessions', 'archive');
    const readFile = vi.spyOn(fs, 'readFile');

    await new SessionStore(workspaceId).loadSession(selectedSessionId);

    const archiveReads = readFile.mock.calls
      .map(([path]) => String(path))
      .filter(path => path.startsWith(archiveDir));
    expect(archiveReads).toHaveLength(1);
    readFile.mockClear();
    await SessionStore.listAllWorkspaceSessions();
    const postPromotionBodyReads = readFile.mock.calls
      .map(([path]) => String(path))
      .filter(path => path.includes(`${workspaceId}/agent-sessions/`))
      .filter(path => path.endsWith('current.json') || path.includes('/archive/'));
    expect(postPromotionBodyReads).toEqual([]);
  });

  it('rebuilds a corrupted metadata index from durable session files', async () => {
    const workspaceId = 'ws-index-rebuild';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.restoreCurrentSession();
    await SessionStore.listAllWorkspaceSessions();
    const metadataPath = join(root, workspaceId, 'agent-sessions', 'metadata.json');
    await fs.writeFile(metadataPath, '{broken index', 'utf-8');

    const groups = await SessionStore.listAllWorkspaceSessions();

    expect(groups.find(group => group.workspaceId === workspaceId)?.sessions[0]?.sessionId)
      .toBe(sessionId);
    expect(JSON.parse(await fs.readFile(metadataPath, 'utf-8'))).toMatchObject({ version: 2 });
  });

  it('tombstones a corrupt archive so later listings stay on the hot path', async () => {
    const workspaceId = 'ws-index-corrupt-archive';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const validSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.startSession();
    const archiveDir = join(root, workspaceId, 'agent-sessions', 'archive');
    await fs.writeFile(join(archiveDir, 'corrupt.json'), '{broken', 'utf-8');

    await SessionStore.listAllWorkspaceSessions();
    const readFile = vi.spyOn(fs, 'readFile');
    const groups = await SessionStore.listAllWorkspaceSessions();

    expect(groups.find(group => group.workspaceId === workspaceId)?.sessions[0]?.sessionId)
      .toBe(validSessionId);
    const sessionBodyReads = readFile.mock.calls
      .map(([path]) => String(path))
      .filter(path => path.includes(`${workspaceId}/agent-sessions/`))
      .filter(path => path.endsWith('current.json') || path.includes('/archive/'));
    expect(sessionBodyReads).toEqual([]);
  });

  it('updates indexed archived sessions after append and replace writes', async () => {
    const workspaceId = 'ws-index-archived-update';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const archivedSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.startSession();
    await SessionStore.listAllWorkspaceSessions();

    await store.appendToSession(archivedSessionId, [makeMessage(1)]);
    await store.replaceMessagesInSession(archivedSessionId, [makeMessage(0), makeMessage(1), makeMessage(2)]);
    const readFile = vi.spyOn(fs, 'readFile');
    const groups = await SessionStore.listAllWorkspaceSessions();

    expect(groups.find(group => group.workspaceId === workspaceId)?.sessions[0])
      .toMatchObject({ sessionId: archivedSessionId, messageCount: 3 });
    const sessionBodyReads = readFile.mock.calls
      .map(([path]) => String(path))
      .filter(path => path.includes(`${workspaceId}/agent-sessions/`))
      .filter(path => path.endsWith('current.json') || path.includes('/archive/'));
    expect(sessionBodyReads).toEqual([]);
  });

  it('does not overwrite metadata after a transient metadata read failure', async () => {
    const workspaceId = 'ws-index-read-failure';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.renameSession(sessionId, 'Keep this title');
    const metadataPath = join(root, workspaceId, 'agent-sessions', 'metadata.json');
    const before = await fs.readFile(metadataPath, 'utf-8');
    const realReadFile = fs.readFile.bind(fs);
    let failed = false;
    vi.spyOn(fs, 'readFile').mockImplementation(async (path, ...args) => {
      if (!failed && String(path) === metadataPath) {
        failed = true;
        throw Object.assign(new Error('too many files'), { code: 'EMFILE' });
      }
      return realReadFile(path, ...args as Parameters<typeof fs.readFile> extends [unknown, ...infer Rest] ? Rest : never) as never;
    });

    await expect(store.setSessionPinned(sessionId, true)).rejects.toThrow('too many files');
    expect(await realReadFile(metadataPath, 'utf-8')).toBe(before);
  });

  it('verifies indexed session identity before promotion and cleanup', async () => {
    const workspaceId = 'ws-index-forged-identity';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const firstSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage({ role: 'user', content: 'first', timestamp: 1 });
    await store.startSession();
    const secondSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage({ role: 'user', content: 'second', timestamp: 2 });
    await store.startSession();
    const archiveDir = join(root, workspaceId, 'agent-sessions', 'archive');
    for (const file of await fs.readdir(archiveDir)) {
      const path = join(archiveDir, file);
      const archived = JSON.parse(await fs.readFile(path, 'utf-8'));
      const timestamp = archived.sessionId === secondSessionId ? 2_000 : 1_000;
      await fs.utimes(path, new Date(timestamp), new Date(timestamp));
    }
    await SessionStore.listAllWorkspaceSessions();
    const metadataPath = join(root, workspaceId, 'agent-sessions', 'metadata.json');
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    const secondPath = Object.keys(metadata.files)
      .find(path => metadata.files[path].sessionId === secondSessionId)!;
    metadata.files[secondPath].sessionId = firstSessionId;
    await fs.writeFile(metadataPath, JSON.stringify(metadata), 'utf-8');

    const promoted = await new SessionStore(workspaceId).loadSession(firstSessionId);

    expect(promoted?.messages[0]?.content).toBe('first');
    expect((await SessionStore.readSessionFromWorkspace(workspaceId, secondSessionId))?.messages[0]?.content)
      .toBe('second');
    const groups = await SessionStore.listAllWorkspaceSessions();
    expect(groups.find(group => group.workspaceId === workspaceId)?.sessions.map(session => session.sessionId))
      .toEqual(expect.arrayContaining([firstSessionId, secondSessionId]));
  });

  it('falls back to durable scanning when indexed identity repair fails', async () => {
    const workspaceId = 'ws-index-repair-failure';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const targetSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage({ role: 'user', content: 'target', timestamp: 1 });
    await store.startSession();
    const unrelatedSessionId = store.getCurrentSession()!.sessionId;
    store.addMessage({ role: 'user', content: 'unrelated', timestamp: 2 });
    await store.startSession();
    await SessionStore.listAllWorkspaceSessions();
    const metadataPath = join(root, workspaceId, 'agent-sessions', 'metadata.json');
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    const unrelatedPath = Object.keys(metadata.files)
      .find(path => metadata.files[path].sessionId === unrelatedSessionId)!;
    metadata.files[unrelatedPath].sessionId = targetSessionId;
    await fs.writeFile(metadataPath, JSON.stringify(metadata), 'utf-8');
    const realRename = fs.rename.bind(fs);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === metadataPath) throw new Error('index repair denied');
      return realRename(from, to);
    });

    const promoted = await new SessionStore(workspaceId).loadSession(targetSessionId);

    expect(promoted?.messages[0]?.content).toBe('target');
    expect((await SessionStore.readSessionFromWorkspace(workspaceId, unrelatedSessionId))?.messages[0]?.content)
      .toBe('unrelated');
  });

  it('falls back to durable scanning when the index has no claimed match', async () => {
    const workspaceId = 'ws-index-false-negative';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sessionId = store.getCurrentSession()!.sessionId;
    store.addMessage({ role: 'user', content: 'still exists', timestamp: 1 });
    await store.startSession();
    await SessionStore.listAllWorkspaceSessions();
    const metadataPath = join(root, workspaceId, 'agent-sessions', 'metadata.json');
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    const targetPath = Object.keys(metadata.files)
      .find(path => metadata.files[path].sessionId === sessionId)!;
    metadata.files[targetPath].sessionId = 'wrong-session-id';
    await fs.writeFile(metadataPath, JSON.stringify(metadata), 'utf-8');

    const promoted = await new SessionStore(workspaceId).loadSession(sessionId);

    expect(promoted?.sessionId).toBe(sessionId);
    expect(promoted?.messages[0]?.content).toBe('still exists');
  });

  it('keeps the filename date fallback for legacy archives without startedAt', async () => {
    const workspaceId = 'ws-index-legacy-date';
    const archiveDir = join(root, workspaceId, 'agent-sessions', 'archive');
    await fs.mkdir(archiveDir, { recursive: true });
    await fs.writeFile(join(archiveDir, '2024-01-02-legacy.json'), JSON.stringify({
      sessionId: 'legacy-session',
      workspaceId,
      messages: [makeMessage(0)],
    }), 'utf-8');

    const groups = await SessionStore.listAllWorkspaceSessions();

    expect(groups.find(group => group.workspaceId === workspaceId)?.sessions[0]?.date)
      .toBe('2024-01-02');
  });

  it('preserves title and pin metadata while rebuilding malformed v2 files', async () => {
    const workspaceId = 'ws-index-malformed-v2';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.renameSession(sessionId, 'Preserved title');
    await store.setSessionPinned(sessionId, true);
    await store.restoreCurrentSession();
    await SessionStore.listAllWorkspaceSessions();
    const metadataPath = join(root, workspaceId, 'agent-sessions', 'metadata.json');
    const malformed = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    malformed.files = 'invalid';
    await fs.writeFile(metadataPath, JSON.stringify(malformed), 'utf-8');

    const groups = await SessionStore.listAllWorkspaceSessions();

    expect(groups.find(group => group.workspaceId === workspaceId)?.sessions[0])
      .toMatchObject({ sessionId, title: 'Preserved title', pinned: true });
  });

  it('does not replace a valid index after a transient inventory failure', async () => {
    const workspaceId = 'ws-index-inventory-failure';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    store.addMessage(makeMessage(0));
    await store.restoreCurrentSession();
    await SessionStore.listAllWorkspaceSessions();
    const metadataPath = join(root, workspaceId, 'agent-sessions', 'metadata.json');
    const currentPath = join(root, workspaceId, 'agent-sessions', 'current.json');
    const before = await fs.readFile(metadataPath, 'utf-8');
    const realStat = fs.stat.bind(fs);
    let failed = false;
    vi.spyOn(fs, 'stat').mockImplementation(async (path) => {
      if (!failed && String(path) === currentPath) {
        failed = true;
        throw Object.assign(new Error('inventory unavailable'), { code: 'EMFILE' });
      }
      return realStat(path);
    });

    await expect(SessionStore.listAllWorkspaceSessions()).rejects.toThrow('inventory unavailable');
    expect(await fs.readFile(metadataPath, 'utf-8')).toBe(before);
  });

  it('rejects malformed tombstone fields and rebuilds the affected index', async () => {
    const workspaceId = 'ws-index-malformed-tombstone';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.restoreCurrentSession();
    await SessionStore.listAllWorkspaceSessions();
    const metadataPath = join(root, workspaceId, 'agent-sessions', 'metadata.json');
    const malformed = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    malformed.files['current.json'].invalid = 'false';
    await fs.writeFile(metadataPath, JSON.stringify(malformed), 'utf-8');

    const groups = await SessionStore.listAllWorkspaceSessions();

    expect(groups.find(group => group.workspaceId === workspaceId)?.sessions[0]?.sessionId)
      .toBe(sessionId);
    const repaired = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    expect(repaired.files['current.json'].invalid).toBeUndefined();
  });

  it('returns rebuilt listings when the derived index cannot be persisted', async () => {
    const workspaceId = 'ws-index-write-failure';
    const store = new SessionStore(workspaceId);
    await store.startSession();
    const sessionId = store.getCurrentSession()!.sessionId;
    store.addMessage(makeMessage(0));
    await store.restoreCurrentSession();
    const metadataPath = join(root, workspaceId, 'agent-sessions', 'metadata.json');
    const realRename = fs.rename.bind(fs);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === metadataPath) throw new Error('index is read-only');
      return realRename(from, to);
    });

    const groups = await SessionStore.listAllWorkspaceSessions();

    expect(groups.find(group => group.workspaceId === workspaceId)?.sessions[0]?.sessionId)
      .toBe(sessionId);
  });

  it('lists scheduled task stores alongside workspaces but still hides internals', async () => {
    const scheduledId = scheduledSessionStoreId('memory-report');
    for (const storeId of ['ws-1', '__global_chat__', scheduledId]) {
      const store = new SessionStore(storeId);
      await store.startSession();
      store.addMessage(makeMessage(0));
      await store.archiveSession();
    }
    // A non-session internal directory must stay invisible.
    await fs.mkdir(join(root, '__manifest__'), { recursive: true });
    await fs.writeFile(join(root, 'scheduled-tasks.json'), '{}', 'utf-8');

    const groups = await SessionStore.listAllWorkspaceSessions();
    const ids = groups.map((group) => group.workspaceId).sort();

    expect(ids).toEqual(['__global_chat__', scheduledId, 'ws-1'].sort());
    expect(groups.find((group) => group.workspaceId === scheduledId)?.sessions.length)
      .toBeGreaterThan(0);
  });
});
