import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { SessionStore } from '../session-store';
import { scheduledSessionStoreId } from '../../../shared/agent-chat';
import type { CanvasAgentMessage } from '../types';

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

    const groups = await SessionStore.listAllWorkspaceSessions();
    const ids = groups.map((group) => group.workspaceId).sort();

    expect(ids).toEqual(['__global_chat__', scheduledId, 'ws-1'].sort());
    expect(groups.find((group) => group.workspaceId === scheduledId)?.sessions.length)
      .toBeGreaterThan(0);
  });
});
