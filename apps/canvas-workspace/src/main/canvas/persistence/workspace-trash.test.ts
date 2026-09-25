import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PulseStorage } from '@pulse-coder/storage';
import { activateLocalCanvasStorage } from '@pulse-coder/storage/local';
import { activateLocalConversationStorage } from '@pulse-coder/storage/local-conversations';
import { closeCanvasStorage, getLocalCanvasStorage } from './backend';
import { setCanvasSessionArchivePort, type CanvasSessionArchivePort } from './session-archive-port';
import { trashWorkspace, saveWorkspaceManifest } from './workspace-trash';
import { filterWorkspaceManifest, listWorkspaces, readWorkspaceManifest } from '../workspaces';
import { ensureWelcomeWorkspaceSeeded } from '../welcome-workspace';

let root: string;
let storage: PulseStorage | undefined;
let port: CanvasSessionArchivePort;
const entry = { id: 'work', name: 'Original name', rootFolder: '/project/root', folderId: 'folder', extension: { keep: true } };
const other = { id: 'other', name: 'Other' };

async function writeManifest(value: unknown) {
  await writeFile(join(root, '__workspaces__.json'), JSON.stringify(value));
}

async function activate(ids = ['work', 'other']) {
  storage = await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: async () => ids.map(id => ({
    workspaceId: id, metadata: {}, nodes: [{ id: 'note', type: 'file', data: { content: '# Original' } }],
    placements: [{ id: 'note', type: 'file', x: 10 }], edges: [],
  })) });
  const conversations = await activateLocalConversationStorage({ root, loadLegacyScopes: async () => ids.map(id => ({
    scopeId: id, currentSessionId: 'session', conversations: [{ sessionId: 'session', metadata: { title: id }, messages: [{ id: 'message', role: 'user', content: 'History' }] }],
  })) });
  await conversations.close();
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pulse-app-workspace-trash-'));
  port = {
    assertWorkspaceStorage: async () => undefined,
    withWorkspaceTrashGuard: async (_id, operation) => operation(),
    exportFiles: () => [],
    prepareImport: (_id, files) => ({ files, currentSessionId: null, conversations: [] }),
    rewriteAttachmentPaths: files => files,
    attachmentPaths: () => [],
  };
  setCanvasSessionArchivePort(port);
});
afterEach(async () => {
  vi.restoreAllMocks();
  setCanvasSessionArchivePort(null);
  await closeCanvasStorage();
  await storage?.close();
  storage = undefined;
  await rm(root, { recursive: true, force: true });
});

describe('App workspace soft deletion', () => {
  it('retains SQL history, raw metadata, every file and the other workspace through trash/restore', async () => {
    await activate();
    await writeManifest({ workspaces: [entry, other], folders: [{ id: 'folder', name: 'Folder' }], activeId: 'work' });
    await mkdir(join(root, 'work', 'notes'), { recursive: true });
    await writeFile(join(root, 'work', 'notes', 'note.md'), '# Original\n');
    await writeFile(join(root, 'work', 'attachment.bin'), Buffer.from([0, 255, 17]));
    await writeFile(join(root, 'work.json'), '{"nodes":[]}');
    const before = await storage!.workspaces.readBundle('work');
    const untouched = await storage!.workspaces.readBundle('other');
    await trashWorkspace(root, 'work');
    const deleted = (await storage!.workspaces.getTrashed('work'))!;
    expect(deleted.metadata).toEqual(entry);
    expect(await readFile(join(root, 'work', 'notes', 'note.md'), 'utf8')).toBe('# Original\n');
    expect(await readFile(join(root, 'work', 'attachment.bin'))).toEqual(Buffer.from([0, 255, 17]));
    expect(await readFile(join(root, 'work.json'), 'utf8')).toBe('{"nodes":[]}');
    expect(await storage!.workspaces.readBundle('work')).toBeNull();
    expect(await storage!.workspaces.readBundle('other')).toEqual(untouched);
    await storage!.workspaces.restoreBundle('work', deleted.revision, deleted.generation);
    const restored = (await storage!.workspaces.readBundle('work'))!;
    expect(restored.canvas.nodes).toEqual(before!.canvas.nodes);
    expect(restored.conversations[0].messages).toEqual(before!.conversations[0].messages);
    expect(restored.conversationScope?.currentSessionId).toBe('session');
  });

  it('filters stale manifest entries and retained directories, including a prepublished CLI restore entry', async () => {
    await activate();
    await mkdir(join(root, 'work'), { recursive: true });
    const raw = { workspaces: [entry, other], folders: [], activeId: 'work' };
    await writeManifest(raw);
    await trashWorkspace(root, 'work');
    expect((await listWorkspaces(root)).workspaces.map(row => row.id)).toEqual(['other']);
    expect(await filterWorkspaceManifest(root, raw)).toMatchObject({ workspaces: [other], activeId: 'other' });
    await writeManifest(raw); // CLI publishes display metadata before SQL restore.
    expect((await readWorkspaceManifest(root)).workspaces.map(row => row.id)).toEqual(['other']);
    const deleted = (await storage!.workspaces.getTrashed('work'))!;
    await storage!.workspaces.restoreBundle('work', deleted.revision, deleted.generation);
    expect((await readWorkspaceManifest(root)).workspaces.map(row => row.id)).toEqual(['work', 'other']);
    expect((await filterWorkspaceManifest(root, raw)).workspaces[0]).not.toHaveProperty('folderId');
    await saveWorkspaceManifest(root, { workspaces: [other], folders: [], activeId: 'other' });
    expect((await readWorkspaceManifest(root)).workspaces.map(row => row.id)).toEqual(['other', 'work']);
  });

  it('refuses legacy deletion without removing JSON or creating an SQLite store', async () => {
    await mkdir(join(root, 'work'), { recursive: true });
    await writeFile(join(root, 'work', 'canvas.json'), '{"nodes":[]}');
    await expect(trashWorkspace(root, 'work')).rejects.toMatchObject({ code: 'storage_unavailable', message: expect.stringContaining('Upgrade') });
    expect(await readFile(join(root, 'work', 'canvas.json'), 'utf8')).toBe('{"nodes":[]}');
    await expect(stat(join(root, '__storage__.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not replace a fully trashed default workspace with a welcome seed', async () => {
    await activate(['default']);
    await mkdir(join(root, 'default'), { recursive: true });
    await writeManifest({ workspaces: [{ id: 'default', name: 'Saved' }], activeId: 'default' });
    await trashWorkspace(root, 'default');
    const deleted = await storage!.workspaces.getTrashed('default');
    expect(await ensureWelcomeWorkspaceSeeded(root)).toEqual({ seeded: false });
    expect(await storage!.workspaces.getTrashed('default')).toEqual(deleted);
    expect((await readWorkspaceManifest(root)).workspaces).toEqual([]);
  });

  it('drains under the runtime guard before taking the root lock, then trashes under that lock', async () => {
    await activate();
    await writeManifest({ workspaces: [entry, other] });
    port.withWorkspaceTrashGuard = async (_id, operation) => {
      await expect(stat(join(root, '__storage_migration__.lock'))).rejects.toMatchObject({ code: 'ENOENT' });
      return operation();
    };
    const connection = (await getLocalCanvasStorage(root))!;
    const original = connection.workspaces.trashBundle.bind(connection.workspaces);
    vi.spyOn(connection.workspaces, 'trashBundle').mockImplementation(async input => {
      expect((await stat(join(root, '__storage_migration__.lock'))).isDirectory()).toBe(true);
      return original(input);
    });
    await trashWorkspace(root, 'work');
  });

  it.each(['different-root', 'busy'])('retains data when the %s guard rejects', async reason => {
    await activate();
    await writeManifest({ workspaces: [entry, other] });
    const before = await storage!.workspaces.readBundle('work');
    if (reason === 'different-root') port.assertWorkspaceStorage = async () => { throw new Error('Separate session root'); };
    else port.withWorkspaceTrashGuard = async () => { throw new Error('Workspace has a running conversation'); };
    await expect(trashWorkspace(root, 'work')).rejects.toThrow();
    expect(await storage!.workspaces.getTrashed('work')).toBeNull();
    expect(await storage!.workspaces.readBundle('work')).toEqual(before);
  });

  it('passes conversation CAS state so a committed append after the snapshot blocks deletion', async () => {
    await activate();
    await writeManifest({ workspaces: [entry, other] });
    const connection = (await getLocalCanvasStorage(root))!;
    const original = connection.workspaces.readBundle.bind(connection.workspaces);
    vi.spyOn(connection.workspaces, 'readBundle').mockImplementationOnce(async id => {
      const snapshot = await original(id);
      const current = (await storage!.conversations.read(id, 'session'))!;
      await storage!.conversations.commit({ scopeId: id, sessionId: 'session', expectedRevision: current.revision,
        expectedGeneration: current.generation, appendMessages: [{ id: 'later', content: 'Concurrent append' }] });
      return snapshot;
    });
    await expect(trashWorkspace(root, 'work')).rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await storage!.workspaces.getTrashed('work')).toBeNull();
    expect((await storage!.conversations.read('work', 'session'))!.messages).toHaveLength(2);
  });
});
