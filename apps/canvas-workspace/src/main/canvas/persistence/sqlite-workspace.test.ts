import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PulseStorage } from '@pulse-coder/storage';
import { activateLocalCanvasStorage } from '@pulse-coder/storage/local';
import { importWorkspaceArchiveToStore } from '../workspace-import';
import { createWorkspaceExportArchive, createWorkspaceExportPayload, type WorkspaceExportFile } from '../workspace-export-archive';
import { closeCanvasStorage } from './backend';
import * as atomicJson from './atomic-json';
import {
  readWorkspaceExportSource,
  rewriteCanvasFilePaths,
  rewriteWorkspaceNodeFiles,
  workspaceExportPathContext,
  WorkspaceImportRecoveryError,
} from './sqlite-workspace';

let root: string;
let storeDir: string;
let storage: PulseStorage;

const file = (relativePath: string, content: string): WorkspaceExportFile => ({
  relativePath, encoding: 'base64', content: Buffer.from(content).toString('base64'),
});

const visible = {
  schemaVersion: 1, id: 'visible', type: 'file', title: 'A card',
  data: { filePath: 'pulsecanvas://workspace/notes/card.md', pluginData: { color: 'red' } },
  properties: { custom: ['one', 'two'] }, links: [{ relation: 'related', target: { nodeId: 'off-canvas' } }],
  futureAtomField: { preserved: true },
};
const offCanvas = {
  schemaVersion: 1, id: 'off-canvas', type: 'file',
  data: { filePath: 'pulsecanvas://workspace/notes/off.md' }, futureAtomField: { number: 42 },
};
const reference = {
  id: 'reference', type: 'reference', ref: { workspaceId: 'other-workspace', nodeId: 'other-node' },
  data: { presentation: 'keep' }, properties: { referenceProperty: true },
};

function oldArchive(schemaVersion: 1 | 2) {
  const { data: _data, properties: _properties, links: _links, ...layout } = visible;
  return createWorkspaceExportPayload({
    exportedAt: '2026-07-01T00:00:00.000Z', workspace: { id: 'old-workspace', name: 'Old board' },
    canvas: {
      schemaVersion, revision: 77, storageGeneration: 'old-storage-generation', futureWorkspaceField: { keep: '中文' },
      nodes: [{ ...(schemaVersion === 1 ? visible : layout), x: 20, futurePlacementField: 'keep' }, reference],
      edges: [{ id: 'edge', source: 'visible', target: 'reference', custom: { dash: 2 } }],
      transform: { x: 4, y: 5, scale: 0.9 },
    },
    files: [
      file('nodes/visible.json', JSON.stringify(visible)), file('nodes/off-canvas.json', JSON.stringify(offCanvas)),
      file('notes/card.md', '# Original Markdown\n'), file('notes/off.md', 'Off-canvas body\n'),
      file('assets/image.bin', 'original attachment bytes'),
    ],
  });
}

async function importArchive(payload = oldArchive(2), workspaceId = 'imported') {
  const sourcePath = join(root, `${workspaceId}.pulsecanvas.zip`);
  await writeFile(sourcePath, createWorkspaceExportArchive(payload));
  return importWorkspaceArchiveToStore({ sourcePath, workspaceId, storeDir, agentsTemplate: '# Agents' });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pulse-sqlite-workspace-'));
  storeDir = join(root, 'canvas');
  storage = await activateLocalCanvasStorage({ root: storeDir, loadLegacyWorkspaces: async () => [] });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await closeCanvasStorage();
  await storage.close();
  await rm(root, { recursive: true, force: true });
});

describe('SQLite workspace archive lifecycle', () => {
  it.each([1, 2] as const)('round-trips old v%s archives including off-canvas atoms, unknown fields, references, and source files', async version => {
    const imported = await importArchive(oldArchive(version));
    expect(imported.canvas).toMatchObject({ revision: 1, futureWorkspaceField: { keep: '中文' } });
    const snapshot = await storage.canvas.read('imported');
    expect(snapshot?.revision).toBe(1);
    expect(snapshot?.metadata).not.toHaveProperty('revision');
    expect(snapshot?.metadata).not.toHaveProperty('storageGeneration');
    expect(snapshot?.nodes).toHaveLength(2);
    expect(await storage.canvas.readNode('imported', 'off-canvas')).toMatchObject({
      futureAtomField: { number: 42 }, data: { filePath: join(storeDir, 'imported', 'notes', 'off.md') },
    });
    expect(snapshot?.placements.find(node => node.id === 'reference')).toEqual(reference);
    expect(JSON.parse(await readFile(join(storeDir, 'imported', 'nodes', 'off-canvas.json'), 'utf8')).data.filePath)
      .toBe(join(storeDir, 'imported', 'notes', 'off.md'));

    const live = (await storage.canvas.readNode('imported', 'visible'))!;
    await storage.canvas.commit({ workspaceId: 'imported', expectedRevision: 1, nodes: { put: [{ ...live, title: 'Newest title' }] } });
    await writeFile(join(storeDir, 'imported', 'nodes', 'visible.json'), JSON.stringify({ ...visible, title: 'Stale file' }));
    await writeFile(join(storeDir, 'imported', 'nodes', 'deleted.json'), JSON.stringify({ id: 'deleted', data: { stale: true } }));
    const legacyReader = vi.fn(async () => { throw new Error('Legacy canvas is stale'); });
    const exported = await readWorkspaceExportSource(storeDir, 'imported', legacyReader);
    expect(legacyReader).not.toHaveBeenCalled();
    expect(exported.canvas).not.toHaveProperty('revision');
    expect(exported.canvas).not.toHaveProperty('storageGeneration');
    expect(exported.canvas).toMatchObject({ schemaVersion: 2, nodes: [expect.objectContaining({ title: 'Newest title' }), reference] });
    expect(exported.files.some(entry => entry.relativePath === 'nodes/deleted.json')).toBe(false);
    expect(await workspaceExportPathContext(exported.canvas, exported.files)).toContainEqual(expect.objectContaining({ id: 'off-canvas' }));
    const makePortable = (path: string) => path.startsWith(`${join(storeDir, 'imported')}/`)
      ? `pulsecanvas://workspace/${encodeURI(relative(join(storeDir, 'imported'), path))}` : path;
    const roundTrip = createWorkspaceExportPayload({
      exportedAt: '2026-09-19T00:00:00.000Z', workspace: { id: 'imported', name: 'Copy' },
      canvas: rewriteCanvasFilePaths(exported.canvas, makePortable),
      files: rewriteWorkspaceNodeFiles(exported.files, makePortable),
    });
    const copied = await importArchive(roundTrip, 'copied');
    expect(copied.canvas).toMatchObject({
      revision: 1,
      futureWorkspaceField: { keep: '中文' },
      nodes: [expect.objectContaining({ title: 'Newest title', futurePlacementField: 'keep' }), reference],
    });
    expect(await storage.canvas.readNode('copied', 'visible')).toMatchObject({
      properties: visible.properties, links: visible.links, futureAtomField: { preserved: true },
      data: { filePath: join(storeDir, 'copied', 'notes', 'card.md'), pluginData: { color: 'red' } },
    });
    expect(await storage.canvas.readNode('copied', 'off-canvas')).toMatchObject({
      futureAtomField: { number: 42 }, data: { filePath: join(storeDir, 'copied', 'notes', 'off.md') },
    });
    expect(await readFile(join(storeDir, 'copied', 'notes', 'card.md'), 'utf8')).toBe('# Original Markdown\n');
    expect(await readFile(join(storeDir, 'copied', 'notes', 'off.md'), 'utf8')).toBe('Off-canvas body\n');
    expect(await readFile(join(storeDir, 'copied', 'assets', 'image.bin'), 'utf8')).toBe('original attachment bytes');
    await expect(stat(join(storeDir, 'copied', '.workspace-import.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('removes its database commit when manifest publication fails, retaining the source archive', async () => {
    const write = atomicJson.atomicWriteJson;
    vi.spyOn(atomicJson, 'atomicWriteJson').mockImplementation(async (path, ...args) => {
      if (path.endsWith('__workspaces__.json')) throw new Error('manifest disk full');
      return write(path, ...args);
    });
    await expect(importArchive()).rejects.toThrow('manifest disk full');
    expect(await storage.canvas.read('imported')).toBeNull();
    await expect(stat(join(storeDir, 'imported'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await stat(join(root, 'imported.pulsecanvas.zip'))).isFile()).toBe(true);
  });

  it('retains files and a recovery journal instead of deleting later edits if compensation conflicts', async () => {
    const write = atomicJson.atomicWriteJson;
    vi.spyOn(atomicJson, 'atomicWriteJson').mockImplementation(async (path, ...args) => {
      if (!path.endsWith('__workspaces__.json')) return write(path, ...args);
      await storage.canvas.commit({ workspaceId: 'imported', expectedRevision: 1, metadata: { laterEdit: true } });
      throw new Error('manifest disk full');
    });
    await expect(importArchive()).rejects.toBeInstanceOf(WorkspaceImportRecoveryError);
    expect(await storage.canvas.read('imported')).toMatchObject({ revision: 2, metadata: { laterEdit: true } });
    expect(await readFile(join(storeDir, 'imported', 'notes', 'card.md'), 'utf8')).toBe('# Original Markdown\n');
    expect(JSON.parse(await readFile(join(storeDir, 'imported', '.workspace-import.json'), 'utf8')))
      .toMatchObject({ workspaceId: 'imported', phase: 'database-committed', revision: 1 });
  });

  it('never exports stale JSON when the active database has no matching workspace', async () => {
    await mkdir(join(storeDir, 'missing'));
    await writeFile(join(storeDir, 'missing', 'canvas.json'), JSON.stringify({ nodes: [{ id: 'stale' }] }));
    const legacyReader = vi.fn(async () => ({ nodes: [{ id: 'stale' }] }));
    await expect(readWorkspaceExportSource(storeDir, 'missing', legacyReader)).rejects.toThrow('missing from active SQLite');
    expect(legacyReader).not.toHaveBeenCalled();
  });

  it.each(['canvas', 'node'] as const)('rejects an unknown %s schema without importing an empty or downgraded workspace', async kind => {
    const payload = oldArchive(2);
    if (kind === 'canvas') payload.canvas = { ...payload.canvas as object, schemaVersion: 99 };
    else payload.files[0] = file('nodes/visible.json', JSON.stringify({ ...visible, schemaVersion: 99 }));
    await expect(importArchive(payload)).rejects.toThrow('Unsupported workspace');
    expect(await storage.canvas.read('imported')).toBeNull();
    await expect(stat(join(storeDir, 'imported'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves legacy v2 per-node imports while rejecting an unknown schema before activation', async () => {
    const legacyRoot = join(root, 'legacy-store');
    const sourcePath = join(root, 'legacy.pulsecanvas.zip');
    await writeFile(sourcePath, createWorkspaceExportArchive(oldArchive(2)));
    await importWorkspaceArchiveToStore({ sourcePath, storeDir: legacyRoot, workspaceId: 'legacy', agentsTemplate: '# Agents' });
    const atom = JSON.parse(await readFile(join(legacyRoot, 'legacy', 'nodes', 'off-canvas.json'), 'utf8'));
    expect(atom).toMatchObject({ futureAtomField: { number: 42 }, data: { filePath: join(legacyRoot, 'legacy', 'notes', 'off.md') } });
    const unknown = oldArchive(2);
    unknown.canvas = { ...unknown.canvas as object, schemaVersion: 3 };
    await writeFile(sourcePath, createWorkspaceExportArchive(unknown));
    await expect(importWorkspaceArchiveToStore({
      sourcePath, storeDir: legacyRoot, workspaceId: 'unknown', agentsTemplate: '# Agents',
    })).rejects.toThrow('Unsupported workspace canvas schema');
    await expect(stat(join(legacyRoot, 'unknown'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to synthesize an empty atom when a v2 archive is missing its node body', async () => {
    const payload = oldArchive(2);
    payload.files = payload.files.filter(entry => entry.relativePath !== 'nodes/visible.json');
    await expect(importArchive(payload)).rejects.toThrow('missing the node body: visible');
    expect(await storage.canvas.read('imported')).toBeNull();
  });

  it('does not publish SQL or delete an existing directory on archive file failure or id collision', async () => {
    const payload = oldArchive(2);
    payload.files.push(file('conflict', 'file'), file('conflict/nested.md', 'nested'));
    await expect(importArchive(payload)).rejects.toThrow();
    expect(await storage.canvas.read('imported')).toBeNull();
    await mkdir(join(storeDir, 'imported'));
    await writeFile(join(storeDir, 'imported', 'keep.md'), 'existing user data');
    await expect(importArchive()).rejects.toThrow('already exists');
    expect(await readFile(join(storeDir, 'imported', 'keep.md'), 'utf8')).toBe('existing user data');
  });
});
