import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateLocalCanvasStorage, openLocalStorage } from '@pulse-coder/storage/local';
import { activateLocalConversationStorage } from '@pulse-coder/storage/local-conversations';
import { prepareLegacyCanvasImport } from '@pulse-coder/storage/canvas';
import * as store from '../store';
import * as sqliteStore from '../sqlite-store';
import { registerWorkspaceCommands } from '../../commands/workspace';
import { setActiveFormat } from '../../output';
import type { CanvasSaveData } from '../types';

let root: string;
const workspaceId = 'ws-trash';
const snapshot: CanvasSaveData = {
  nodes: [{ id: 'text', type: 'text', title: 'Keep', x: 0, y: 0, width: 100, height: 100, data: { content: 'Keep SQL content' } }],
  edges: [], transform: { x: 10, y: 20, scale: 1 }, savedAt: '2026-09-19T00:00:00.000Z',
};

async function storage() {
  const opened = await openLocalStorage({ root });
  if (!opened) throw new Error('Fixture must be active');
  return opened;
}

function cli(): Command {
  const program = new Command().exitOverride();
  program.option('--store-dir <path>').option('--format <format>', 'Output format', 'json');
  registerWorkspaceCommands(program);
  return program;
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'workspace-trash-cli-'));
  await store.saveCanvas(workspaceId, snapshot, root);
  const manifest = {
    workspaces: [{ id: workspaceId, name: 'Original name', folderId: 'folder-a', custom: { retained: true } }],
    activeId: workspaceId,
  };
  await store.saveWorkspaceManifest(manifest, root);
  await fs.writeFile(join(root, workspaceId, 'note.md'), 'Original Markdown');
  const canvas = await activateLocalCanvasStorage({
    root, loadLegacyWorkspaces: async () => [prepareLegacyCanvasImport(workspaceId, snapshot)],
  });
  await canvas.close();
  const db = await activateLocalConversationStorage({ root, loadLegacyScopes: async () => [] });
  try {
    for (const scopeId of [workspaceId, '__global_chat__', 'other-workspace']) {
      await db.conversationScopes.commit({
        scopeId, expectedRevision: null, currentSessionId: 'session',
        conversations: [{ sessionId: 'session', expectedRevision: null,
          metadata: { title: scopeId }, appendMessages: [{ id: 'message', role: 'user', content: scopeId }] }],
      });
    }
  } finally { await db.close(); }
});

afterEach(async () => {
  vi.restoreAllMocks();
  setActiveFormat('text');
  await fs.rm(root, { recursive: true, force: true });
});

describe('recoverable workspace deletion', () => {
  it('restores the original name, canvas, conversation pointer and history without rewriting files', async () => {
    const stale = await store.loadCanvas(workspaceId, root);
    expect(await store.deleteWorkspace(workspaceId, root)).toMatchObject({ ok: true });
    expect(await store.listWorkspaceIds(root)).toEqual([]);
    expect(await store.loadCanvas(workspaceId, root)).toBeNull();
    expect(await store.listDeletedWorkspaces(root)).toMatchObject([{ workspaceId, metadata: { name: 'Original name' } }]);
    let db = await storage();
    try {
      expect(await db.conversations.read(workspaceId, 'session')).toBeNull();
      expect(await db.conversationScopes.read(workspaceId)).toBeNull();
      for (const scopeId of ['__global_chat__', 'other-workspace']) {
        expect(await db.conversations.read(scopeId, 'session')).toMatchObject({ revision: 1, messages: [{ content: scopeId }] });
      }
    } finally { await db.close(); }
    const note = join(root, workspaceId, 'note.md');
    expect(await fs.readFile(note, 'utf8')).toBe('Original Markdown');
    await fs.writeFile(note, 'External edit while in trash');
    expect(await store.restoreWorkspace(workspaceId, root)).toMatchObject({ ok: true });
    expect(await store.listDeletedWorkspaces(root)).toEqual([]);
    expect((await store.loadWorkspaceManifest(root)).workspaces).toEqual([
      { id: workspaceId, name: 'Original name', folderId: 'folder-a', custom: { retained: true } },
    ]);
    expect((await store.loadCanvas(workspaceId, root))?.nodes).toEqual(snapshot.nodes);
    expect(await fs.readFile(note, 'utf8')).toBe('External edit while in trash');
    await expect(store.saveCanvas(workspaceId, stale!, root)).rejects.toMatchObject({ code: 'revision_conflict' });
    db = await storage();
    try {
      expect(await db.conversationScopes.read(workspaceId)).toMatchObject({ currentSessionId: 'session' });
      expect(await db.conversations.read(workspaceId, 'session')).toMatchObject({ messages: [{ content: workspaceId }] });
    } finally { await db.close(); }
  });

  it('keeps the workspace in trash if manifest publication fails and supports a retry', async () => {
    expect(await store.deleteWorkspace(workspaceId, root)).toMatchObject({ ok: true });
    const rename = fs.rename.bind(fs);
    const failure = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === join(root, '__workspaces__.json')) throw new Error('Manifest publication failed');
      return rename(from, to);
    });
    expect(await store.restoreWorkspace(workspaceId, root)).toMatchObject({ ok: false });
    expect(await store.loadCanvas(workspaceId, root)).toBeNull();
    expect(await store.listDeletedWorkspaces(root)).toHaveLength(1);
    failure.mockRestore();
    expect(await store.restoreWorkspace(workspaceId, root)).toMatchObject({ ok: true });
    expect((await store.loadWorkspaceManifest(root)).workspaces[0].name).toBe('Original name');
  });

  it('preserves other workspace entries, shared folders and unknown manifest fields', async () => {
    const other = { id: 'other-workspace', name: 'Other', folderId: 'folder-a', custom: 'unchanged' };
    const manifest = {
      ...await store.loadWorkspaceManifest(root),
      folders: [{ id: 'folder-a', name: 'Folder', parentId: null }],
      futureMetadata: { retained: [1, 2, 3] },
    };
    manifest.workspaces.push(other);
    await store.saveWorkspaceManifest(manifest, root);
    const db = await storage();
    try { await db.canvas.commit({ workspaceId: other.id, expectedRevision: null }); }
    finally { await db.close(); }
    expect(await store.deleteWorkspace(workspaceId, root)).toMatchObject({ ok: true });
    expect(await store.loadWorkspaceManifest(root)).toMatchObject({
      workspaces: [other], folders: manifest.folders, futureMetadata: manifest.futureMetadata,
    });
    expect(await store.restoreWorkspace(workspaceId, root)).toMatchObject({ ok: true });
    const restored = await store.loadWorkspaceManifest(root);
    expect(restored).toMatchObject({ folders: manifest.folders, futureMetadata: manifest.futureMetadata });
    expect(restored.workspaces.find(entry => entry.id === other.id)).toEqual(other);
    expect((await store.loadCanvas(other.id, root))?.revision).toBe(1);
  });

  it('hides stale manifest entries after an interrupted deletion and finishes cleanup on retry', async () => {
    const rename = fs.rename.bind(fs);
    const failure = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(to) === join(root, '__workspaces__.json')) throw new Error('Manifest publication failed');
      return rename(from, to);
    });
    expect(await store.deleteWorkspace(workspaceId, root)).toMatchObject({ ok: false });
    expect(await store.listWorkspaceIds(root)).toEqual([]);
    expect((await store.loadWorkspaceManifest(root)).workspaces).toEqual([]);
    expect(await store.listDeletedWorkspaces(root)).toMatchObject([{ metadata: { name: 'Original name' } }]);
    expect(await fs.readFile(join(root, workspaceId, 'note.md'), 'utf8')).toBe('Original Markdown');
    failure.mockRestore();
    expect(await store.deleteWorkspace(workspaceId, root)).toMatchObject({ ok: true });
    expect(await store.restoreWorkspace(workspaceId, root)).toMatchObject({ ok: true });
  });

  it('rejects deletion if a conversation changes after the snapshot was read', async () => {
    const original = sqliteStore.withSqliteCanvas;
    vi.spyOn(sqliteStore, 'withSqliteCanvas').mockImplementation((storeDir, operation) => original(storeDir, async (db, canvas) => {
      const read = db.workspaces.readBundle.bind(db.workspaces);
      db.workspaces.readBundle = async id => {
        const current = await read(id);
        await db.conversations.commit({ scopeId: id, sessionId: 'new-session', expectedRevision: null });
        return current;
      };
      return operation(db, canvas);
    }));
    expect(await store.deleteWorkspace(workspaceId, root)).toMatchObject({ ok: false, code: 'revision_conflict' });
    expect(await store.loadCanvas(workspaceId, root)).not.toBeNull();
    expect((await store.loadWorkspaceManifest(root)).workspaces[0].name).toBe('Original name');
    expect(await store.listDeletedWorkspaces(root)).toEqual([]);
  });

  it('offers discoverable trash and restore commands with stable JSON output', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await cli().parseAsync(['node', 'pulse-canvas', '--store-dir', root, 'workspace', 'delete', workspaceId, '--confirm']);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toEqual({ deleted: workspaceId, recoverable: true });
    await cli().parseAsync(['node', 'pulse-canvas', '--store-dir', root, 'workspace', 'trash']);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toMatchObject([{ id: workspaceId, name: 'Original name', deletedAt: expect.any(String) }]);
    await cli().parseAsync(['node', 'pulse-canvas', '--store-dir', root, 'workspace', 'restore', workspaceId]);
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toEqual({ restored: workspaceId });
  });

  it('requires confirmation before hiding a workspace', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('CLI stopped'); });
    await expect(cli().parseAsync(['node', 'pulse-canvas', '--store-dir', root, 'workspace', 'delete', workspaceId]))
      .rejects.toThrow('CLI stopped');
    expect(await store.loadCanvas(workspaceId, root)).not.toBeNull();
    expect(await store.listDeletedWorkspaces(root)).toEqual([]);
  });
});
