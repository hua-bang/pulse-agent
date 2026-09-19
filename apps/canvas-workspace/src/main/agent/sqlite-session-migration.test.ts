import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { activateLocalCanvasStorage, readLocalStorageStatus } from '@pulse-coder/storage/local';
import { activateSqliteSessions, readLegacySessionScopes } from './sqlite-session-migration';
import { closeSqliteSessionStorage, getSqliteSessionStorage } from './sqlite-session-backend';
import { SessionStore } from './session-store';

let root: string;
let previousRoot: string | undefined;
const session = (sessionId: string, content: string) => ({
  sessionId, workspaceId: 'ws', scope: { kind: 'workspace', workspaceId: 'ws' },
  startedAt: '2026-07-01T00:00:00.000Z',
  messages: [{ role: 'user', content, timestamp: 1, unknownMessageField: { keep: true } }],
});

beforeEach(async () => {
  previousRoot = process.env.PULSE_CANVAS_SESSION_STORE_DIR;
  root = await mkdtemp(join(tmpdir(), 'canvas-session-upgrade-'));
  process.env.PULSE_CANVAS_SESSION_STORE_DIR = root;
  await mkdir(join(root, 'ws', 'agent-sessions', 'archive'), { recursive: true });
});
afterEach(async () => {
  await closeSqliteSessionStorage();
  if (previousRoot === undefined) delete process.env.PULSE_CANVAS_SESSION_STORE_DIR;
  else process.env.PULSE_CANVAS_SESSION_STORE_DIR = previousRoot;
  await rm(root, { recursive: true, force: true });
});

describe('first session upgrade', () => {
  it('refuses conflicting duplicate archives with equal mtimes while current history remains authoritative', async () => {
    const directory = join(root, 'ws', 'agent-sessions');
    const first = join(directory, 'archive', 'first.json');
    const second = join(directory, 'archive', 'second.json');
    await writeFile(first, JSON.stringify(session('same', 'one')));
    await writeFile(second, JSON.stringify(session('same', 'two')));
    await utimes(first, new Date(1000), new Date(1000));
    await utimes(second, new Date(1000), new Date(1000));
    await expect(activateSqliteSessions(root)).rejects.toThrow('no reliable newest version');
    expect(await readLocalStorageStatus(root)).toBeNull();
    await writeFile(join(directory, 'current.json'), JSON.stringify(session('same', 'current wins')));
    await activateSqliteSessions(root);
    expect((await SessionStore.readSessionFromWorkspace('ws', 'same'))?.messages[0].content).toBe('current wins');
  });

  it('keeps a custom session root separate from the Canvas data root', async () => {
    const canvasRoot = join(root, 'separate-canvas-root');
    await mkdir(join(canvasRoot, 'ws', 'agent-sessions'), { recursive: true });
    const untouched = join(canvasRoot, 'ws', 'agent-sessions', 'current.json');
    await writeFile(untouched, JSON.stringify(session('different-root', 'must stay separate')));
    await writeFile(join(root, 'ws', 'agent-sessions', 'current.json'), JSON.stringify(session('custom-root', 'custom')));
    const canvasStorage = await activateLocalCanvasStorage({ root: canvasRoot, loadLegacyWorkspaces: async () => [] });
    await canvasStorage.close();
    await activateSqliteSessions();
    expect((await readLocalStorageStatus(canvasRoot))?.domains).toEqual(['canvas']);
    expect((await readLocalStorageStatus(root))?.domains).toEqual(['conversations']);
    expect(await SessionStore.readSessionFromWorkspace('ws', 'different-root')).toBeNull();
    expect((await SessionStore.readSessionFromWorkspace('ws', 'custom-root'))?.messages[0].content).toBe('custom');
    expect(JSON.parse(await readFile(untouched, 'utf8')).messages[0].content).toBe('must stay separate');
  });

  it('prefers current history, selects the newest duplicate archive and preserves metadata and stable IDs without changing source files', async () => {
    const directory = join(root, 'ws', 'agent-sessions');
    const currentPath = join(directory, 'current.json');
    const raw = JSON.stringify(session('current', 'authoritative current'));
    await writeFile(currentPath, raw);
    await writeFile(join(directory, 'archive', 'current-copy.json'), JSON.stringify(session('current', 'stale duplicate')));
    const oldPath = join(directory, 'archive', 'old-copy.json');
    const newPath = join(directory, 'archive', 'new-copy.json');
    await writeFile(oldPath, JSON.stringify(session('archive', 'old')));
    await writeFile(newPath, JSON.stringify(session('archive', 'new')));
    await utimes(oldPath, new Date(1000), new Date(1000));
    await utimes(newPath, new Date(2000), new Date(2000));
    await writeFile(join(directory, 'metadata.json'), JSON.stringify({ version: 2, sessions: { archive: { title: 'Kept title', pinned: true } }, files: {} }));
    const first = await readLegacySessionScopes(root);
    expect(await readLegacySessionScopes(root)).toEqual(first);
    await activateSqliteSessions(root);
    expect(await readFile(currentPath, 'utf8')).toBe(raw);
    const storage = (await getSqliteSessionStorage(root))!;
    expect(await storage.conversationScopes.read('ws')).toMatchObject({ currentSessionId: 'current' });
    expect((await storage.conversations.read('ws', 'current'))?.messages[0]).toMatchObject({ content: 'authoritative current', unknownMessageField: { keep: true } });
    const archive = (await storage.conversations.read('ws', 'archive'))!;
    expect(archive.messages[0].content).toBe('new');
    expect(archive.messages[0].id).toBe(first[0].conversations.find(entry => entry.sessionId === 'archive')!.messages[0].id);
    const store = new SessionStore('ws');
    await store.restoreCurrentSession();
    expect(await store.listSessions()).toContainEqual(expect.objectContaining({ sessionId: 'archive', title: 'Kept title', pinned: true }));
    await writeFile(currentPath, JSON.stringify(session('current', 'old process wrote here')));
    await activateSqliteSessions(root);
    expect((await SessionStore.readSessionFromWorkspace('ws', 'current'))?.messages[0].content).toBe('authoritative current');
  });

  it.each(['current', 'archive', 'metadata', 'future'])('refuses to activate on corrupted or unsupported %s data', async kind => {
    const directory = join(root, 'ws', 'agent-sessions');
    await writeFile(join(directory, 'current.json'), JSON.stringify(session('current', 'keep')));
    if (kind === 'current') await writeFile(join(directory, 'current.json'), '{broken');
    if (kind === 'archive') await writeFile(join(directory, 'archive', 'broken.json'), '{broken');
    if (kind === 'metadata') await writeFile(join(directory, 'metadata.json'), '{broken');
    if (kind === 'future') await writeFile(join(directory, 'current.json'), JSON.stringify({ ...session('current', 'keep'), schemaVersion: 99 }));
    await expect(activateSqliteSessions(root)).rejects.toThrow();
    expect(await readLocalStorageStatus(root)).toBeNull();
  });

  it('keeps the old JSON SessionStore writable before migration and prevents late JSON persistence after activation', async () => {
    const legacy = new SessionStore('ws');
    await legacy.startSession();
    const id = legacy.getCurrentSession()!.sessionId;
    legacy.addMessage({ role: 'user', content: 'before upgrade', timestamp: 1 });
    await legacy.readSession(id);
    const path = join(root, 'ws', 'agent-sessions', 'current.json');
    const before = await readFile(path, 'utf8');
    await activateSqliteSessions(root);
    legacy.addMessage({ role: 'user', content: 'late stale writer', timestamp: 2 });
    await expect(legacy.readSession(id)).rejects.toThrow();
    expect(await readFile(path, 'utf8')).toBe(before);
    expect((await SessionStore.readSessionFromWorkspace('ws', id))?.messages.map(message => message.content)).toEqual(['before upgrade']);
  });
});
