import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activateLocalCanvasStorage } from '@pulse-coder/storage/local';
import { prepareLegacyCanvasImport } from '@pulse-coder/storage/canvas';
import { createWorkspaceExportArchive, createWorkspaceExportPayload, type WorkspaceExportFile } from '../canvas/workspace-export-archive';
import { importWorkspaceArchiveToStore } from '../canvas/workspace-import';
import { closeCanvasStorage } from '../canvas/persistence/backend';
import { setCanvasSessionArchivePort } from '../canvas/persistence/session-archive-port';
import { readWorkspaceExportSource, rewriteCanvasFilePaths, rewriteWorkspaceArchiveFiles, WorkspaceImportRecoveryError } from '../canvas/persistence/sqlite-workspace';
import * as atomicJson from '../canvas/persistence/atomic-json';
import { createCanvasSessionArchivePort, initializeCanvasSessionArchivePort } from './workspace-session-archive';
import { activateSqliteSessions } from './sqlite-session-migration';
import { closeSqliteSessionStorage, getSqliteSessionStorage } from './sqlite-session-backend';
import { SessionStore } from './session-store';

const file = (relativePath: string, contents: unknown): WorkspaceExportFile => ({
  relativePath, encoding: 'base64', content: Buffer.from(JSON.stringify(contents)).toString('base64'),
});
const parsed = (entry: WorkspaceExportFile) => JSON.parse(Buffer.from(entry.content, 'base64').toString('utf8'));
const history = (sessionId: string, content: string, timestamp = 1) => ({
  sessionId, workspaceId: 'source', scope: { kind: 'workspace', workspaceId: 'source' }, startedAt: '2026-07-01T00:00:00.000Z',
  messages: [{ role: 'user', content, timestamp, unknownField: { keep: true } }],
});

let root: string;
let storeDir: string;
let previousRoot: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'workspace-conversation-archive-'));
  storeDir = join(root, 'canvas');
  previousRoot = process.env.PULSE_CANVAS_SESSION_STORE_DIR;
  process.env.PULSE_CANVAS_SESSION_STORE_DIR = storeDir;
  initializeCanvasSessionArchivePort();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await closeSqliteSessionStorage();
  await closeCanvasStorage();
  setCanvasSessionArchivePort(null);
  if (previousRoot === undefined) delete process.env.PULSE_CANVAS_SESSION_STORE_DIR;
  else process.env.PULSE_CANVAS_SESSION_STORE_DIR = previousRoot;
  await rm(root, { recursive: true, force: true });
});

async function seedLegacyAndUpgrade() {
  const directory = join(storeDir, 'source');
  await mkdir(join(directory, 'agent-sessions', 'archive'), { recursive: true });
  await mkdir(join(directory, 'agent-sessions', 'images'), { recursive: true });
  const attachmentPath = join(directory, 'agent-sessions', 'images', 'image.png');
  await writeFile(attachmentPath, Buffer.from([1, 2, 3, 4]));
  const current = {
    ...history('current', `Keep literal path ${attachmentPath}`),
    messages: [{
      ...history('current', `Keep literal path ${attachmentPath}`).messages[0],
      attachments: [{ id: 'image', path: attachmentPath, mimeType: 'image/png' }],
      toolCalls: [{ id: 1, name: 'bash', status: 'succeeded', args: { command: `cat ${attachmentPath}`, path: attachmentPath }, result: 'historic output' }],
      contextSnapshot: { scope: { kind: 'workspace', workspaceId: 'source' }, scopeLabel: 'Original scope' },
    }],
  };
  const records = [
    file('agent-sessions/current.json', current),
    file('agent-sessions/archive/2026-07-01.json', history('archived', 'archive', 2)),
    file('agent-sessions/metadata.json', { version: 2, sessions: { current: { title: 'Old title' }, archived: { title: 'Pinned archive', pinned: true, customFlag: 'keep' } }, files: {} }),
  ];
  for (const record of records) await writeFile(join(directory, record.relativePath), Buffer.from(record.content, 'base64'));
  const storage = await activateLocalCanvasStorage({ root: storeDir, loadLegacyWorkspaces: async () => [
    prepareLegacyCanvasImport('source', { nodes: [{ id: 'node', type: 'note', data: { content: 'canvas body' } }], edges: [] }),
  ] });
  await storage.close();
  await activateSqliteSessions(storeDir);
  return { current, directory, attachmentPath };
}

describe('workspace conversation archive port', () => {
  it.each([true, false])('rejects full export and import with a separate session database before touching archive state (archive has sessions: %s)', async hasSessions => {
    await seedLegacyAndUpgrade();
    const separateRoot = join(root, 'separate-sessions');
    process.env.PULSE_CANVAS_SESSION_STORE_DIR = separateRoot;
    await activateSqliteSessions(separateRoot);
    const independent = new SessionStore('source');
    await independent.startSession();
    independent.addMessage({ role: 'user', content: 'Independent conversation', timestamp: 12 });
    const id = independent.getCurrentSession()!.sessionId;
    expect((await independent.readSession(id))?.messages[0].content).toBe('Independent conversation');
    const canvasStorage = (await getSqliteSessionStorage(storeDir))!;
    const sessionStorage = (await getSqliteSessionStorage(separateRoot))!;
    const archive = join(root, 'separate.pulsecanvas.zip');
    await writeFile(archive, createWorkspaceExportArchive(createWorkspaceExportPayload({
      exportedAt: '2026-09-19T00:00:00Z', workspace: { id: 'source', name: 'Copy' },
      canvas: { nodes: [], edges: [] }, files: hasSessions ? [file('agent-sessions/current.json', history('imported', 'Keep me'))] : [],
    })));
    const directoryBefore = (await readdir(storeDir)).sort();
    const legacyReader = vi.fn();

    await expect(readWorkspaceExportSource(storeDir, 'source', legacyReader))
      .rejects.toThrow('separate conversation storage root');
    await expect(importWorkspaceArchiveToStore({ sourcePath: archive, storeDir, workspaceId: 'copy', agentsTemplate: '# Agents' }))
      .rejects.toThrow('separate conversation storage root');

    expect(legacyReader).not.toHaveBeenCalled();
    expect((await readdir(storeDir)).sort()).toEqual(directoryBefore);
    expect(await canvasStorage.workspaces.readBundle('copy')).toBeNull();
    expect(await sessionStorage.conversationScopes.read('copy')).toBeNull();
    expect((await independent.readSession(id))?.messages[0].content).toBe('Independent conversation');
  });

  it('allows a session root symlink that resolves to the same workspace database', async () => {
    await seedLegacyAndUpgrade();
    const alias = join(root, 'session-alias');
    await symlink(storeDir, alias, 'dir');
    process.env.PULSE_CANVAS_SESSION_STORE_DIR = alias;
    const source = await readWorkspaceExportSource(storeDir, 'source', async () => null);
    expect(source.files.some(entry => entry.relativePath === 'agent-sessions/current.json')).toBe(true);
    const archive = join(root, 'alias.pulsecanvas.zip');
    await writeFile(archive, createWorkspaceExportArchive(createWorkspaceExportPayload({
      exportedAt: '2026-09-19T00:00:00Z', workspace: { id: 'source', name: 'Copy' }, canvas: source.canvas, files: source.files,
    })));
    await importWorkspaceArchiveToStore({ sourcePath: archive, storeDir, workspaceId: 'copy', agentsTemplate: '# Agents' });
    expect((await (await getSqliteSessionStorage(storeDir))!.workspaces.readBundle('copy'))?.conversations).toHaveLength(2);
  });

  it('keeps current priority and selects indexed duplicate archives while preserving literal history', () => {
    const port = createCanvasSessionArchivePort();
    const files = [
      file('agent-sessions/archive/current-a.json', history('current', 'old duplicate A')),
      file('agent-sessions/archive/current-b.json', history('current', 'old duplicate B')),
      file('agent-sessions/current.json', history('current', 'canonical current')),
      file('agent-sessions/archive/older.json', history('archive', 'old')),
      file('agent-sessions/archive/newer.json', history('archive', 'new')),
      file('agent-sessions/metadata.json', { version: 2, sessions: { archive: { title: 'Title', pinned: true } }, files: {
        'archive/older.json': { mtimeMs: 1 }, 'archive/newer.json': { mtimeMs: 2 },
      } }),
    ];
    const imported = port.prepareImport('copy', files, path => path);
    expect(imported.currentSessionId).toBe('current');
    expect(imported.conversations.find(record => record.sessionId === 'current')?.messages[0].content).toBe('canonical current');
    expect(imported.conversations.find(record => record.sessionId === 'archive')).toMatchObject({ metadata: { title: 'Title', pinned: true }, messages: [{ content: 'new' }] });
    expect(port.prepareImport('copy', files, path => path).conversations).toEqual(imported.conversations);
  });

  it('rejects unsupported or ambiguous legacy session archives instead of choosing an empty or arbitrary history', () => {
    const port = createCanvasSessionArchivePort();
    expect(() => port.prepareImport('copy', [
      file('agent-sessions/current.json', { ...history('current', 'keep'), schemaVersion: 99 }),
    ], path => path)).toThrow('Unsupported session schema');
    expect(() => port.prepareImport('copy', [
      file('agent-sessions/archive/first.json', history('same', 'one')),
      file('agent-sessions/archive/second.json', history('same', 'two')),
    ], path => path)).toThrow('no reliable newest version');
  });

  it('exports current SQL conversations and imports their pointer, metadata and portable attachments into the new workspace', async () => {
    const seeded = await seedLegacyAndUpgrade();
    const store = new SessionStore('source');
    await store.restoreCurrentSession();
    store.addMessage({ role: 'assistant', content: 'latest SQL reply', timestamp: 3 });
    await store.renameSession('current', 'Latest title');
    await writeFile(join(seeded.directory, 'agent-sessions', 'current.json'), '{stale legacy file');
    await writeFile(join(seeded.directory, 'agent-sessions', 'archive', 'stale-extra.json'), JSON.stringify(history('stale-extra', 'must not export')));
    const source = await readWorkspaceExportSource(storeDir, 'source', async () => { throw new Error('must use SQL'); });
    expect(source.files.some(entry => entry.relativePath.includes('stale-extra'))).toBe(false);
    expect(source.files.some(entry => entry.relativePath === 'agent-sessions/images/image.png')).toBe(true);
    const current = parsed(source.files.find(entry => entry.relativePath === 'agent-sessions/current.json')!);
    expect(current.messages.map((message: { content: string }) => message.content)).toEqual([seeded.current.messages[0].content, 'latest SQL reply']);
    const portable = (path: string) => path.startsWith(`${seeded.directory}/`)
      ? `pulsecanvas://workspace/${relative(seeded.directory, path)}` : path;
    const files = await rewriteWorkspaceArchiveFiles(source.files, portable);
    const encodedCurrent = parsed(files.find(entry => entry.relativePath === 'agent-sessions/current.json')!);
    expect(encodedCurrent.messages[0].attachments[0].path).toBe('pulsecanvas://workspace/agent-sessions/images/image.png');
    expect(encodedCurrent.messages[0].content).toBe(seeded.current.messages[0].content);
    expect(encodedCurrent.messages[0].toolCalls).toEqual(seeded.current.messages[0].toolCalls);
    const archive = join(root, 'export.pulsecanvas.zip');
    await writeFile(archive, createWorkspaceExportArchive(createWorkspaceExportPayload({
      exportedAt: '2026-09-19T00:00:00Z', workspace: { id: 'source', name: 'Copy' },
      canvas: rewriteCanvasFilePaths(source.canvas, portable), files,
    })));
    await importWorkspaceArchiveToStore({ sourcePath: archive, storeDir, workspaceId: 'copy', agentsTemplate: '# Agents' });
    const storage = (await getSqliteSessionStorage(storeDir))!;
    const copied = (await storage.workspaces.readBundle('copy'))!;
    expect(copied.conversationScope?.currentSessionId).toBe('current');
    const chat = copied.conversations.find(record => record.sessionId === 'current')!;
    expect(chat.metadata).toMatchObject({ title: 'Latest title', session: { workspaceId: 'copy', scope: { kind: 'workspace', workspaceId: 'copy' } } });
    expect(chat.messages[0]).toMatchObject({
      content: seeded.current.messages[0].content,
      attachments: [{ path: join(storeDir, 'copy', 'agent-sessions', 'images', 'image.png') }],
      toolCalls: seeded.current.messages[0].toolCalls,
      contextSnapshot: seeded.current.messages[0].contextSnapshot,
      unknownField: { keep: true },
    });
    expect(copied.conversations.find(record => record.sessionId === 'archived')?.metadata)
      .toMatchObject({ title: 'Pinned archive', pinned: true, customFlag: 'keep' });
    expect(await readFile(join(storeDir, 'copy', 'agent-sessions', 'images', 'image.png'))).toEqual(Buffer.from([1, 2, 3, 4]));
  });

  it('preserves later chat work when manifest failure attempts to compensate a Canvas import', async () => {
    await seedLegacyAndUpgrade();
    const source = await readWorkspaceExportSource(storeDir, 'source', async () => null);
    const archive = join(root, 'restore.pulsecanvas.zip');
    await writeFile(archive, createWorkspaceExportArchive(createWorkspaceExportPayload({
      exportedAt: '2026-09-19T00:00:00Z', workspace: { id: 'source', name: 'Recovery' }, canvas: source.canvas, files: source.files,
    })));
    const storage = (await getSqliteSessionStorage(storeDir))!;
    const write = atomicJson.atomicWriteJson;
    vi.spyOn(atomicJson, 'atomicWriteJson').mockImplementation(async (path, ...args) => {
      if (!path.endsWith('__workspaces__.json')) return write(path, ...args);
      await storage.conversations.commit({
        scopeId: 'recovery', sessionId: 'current', expectedRevision: 1, expectedGeneration: storage.generation,
        appendMessages: [{ id: 'later-message', role: 'user', content: 'New work after import', timestamp: 9 }],
      });
      throw new Error('manifest unavailable');
    });
    await expect(importWorkspaceArchiveToStore({ sourcePath: archive, storeDir, workspaceId: 'recovery', agentsTemplate: '# Agents' }))
      .rejects.toBeInstanceOf(WorkspaceImportRecoveryError);
    expect((await storage.canvas.read('recovery'))?.revision).toBe(1);
    expect((await storage.conversations.read('recovery', 'current'))?.messages.at(-1)?.content).toBe('New work after import');
    expect(JSON.parse(await readFile(join(storeDir, 'recovery', '.workspace-import.json'), 'utf8')))
      .toMatchObject({ phase: 'database-committed', conversationState: { scope: { revision: 1 } } });
  });
});
