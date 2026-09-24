import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import type { PulseStorage } from '@pulse-coder/storage';
import { activateLocalCanvasStorage } from '@pulse-coder/storage/local';
import { recoverInterruptedWorkspaceImports } from './import-recovery';
import { IMPORT_JOURNAL } from './sqlite-workspace';

let root: string;
let storage: PulseStorage;
const manifest = { workspaces: [{ id: 'existing', name: 'Existing' }], folders: [{ id: 'folder', name: 'Folder' }], activeId: 'existing' };

async function stageImport(workspaceId: string, journal: unknown = {
  schemaVersion: 1, workspaceId, workspaceName: `Imported ${workspaceId}`, phase: 'database-committed',
}): Promise<void> {
  await mkdir(join(root, workspaceId, 'nodes'), { recursive: true });
  await writeFile(join(root, workspaceId, 'note.md'), `notes for ${workspaceId}`);
  await writeFile(join(root, workspaceId, IMPORT_JOURNAL), typeof journal === 'string' ? journal : JSON.stringify(journal));
}

async function commit(workspaceId: string) {
  return storage.workspaces.importBundle({
    canvas: { workspaceId, metadata: {}, nodes: [], placements: [], edges: [] },
  });
}

const readManifest = async () => JSON.parse(await readFile(join(root, '__workspaces__.json'), 'utf8'));

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'import-recovery-'));
  storage = await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: async () => [] });
  await writeFile(join(root, '__workspaces__.json'), JSON.stringify(manifest));
});
afterEach(async () => {
  await storage.close();
  await rm(root, { recursive: true, force: true });
});

it('publishes a committed import that never reached the manifest, keeping the current selection', async () => {
  await commit('ws-committed');
  await stageImport('ws-committed');
  expect(await recoverInterruptedWorkspaceImports(root, storage)).toEqual([{ workspaceId: 'ws-committed', outcome: 'published' }]);
  expect(await readManifest()).toMatchObject({
    workspaces: [manifest.workspaces[0], { id: 'ws-committed', name: 'Imported ws-committed' }],
    folders: manifest.folders,
    activeId: 'existing',
  });
  expect(await readdir(join(root, 'ws-committed'))).not.toContain(IMPORT_JOURNAL);
  expect(await recoverInterruptedWorkspaceImports(root, storage)).toEqual([]);
});

it('only removes the journal when the import was already published or later deleted', async () => {
  await commit('ws-published');
  await stageImport('ws-published');
  await writeFile(join(root, '__workspaces__.json'), JSON.stringify({
    ...manifest, workspaces: [...manifest.workspaces, { id: 'ws-published', name: 'Renamed by user' }],
  }));
  await commit('ws-trashed').then(trashReceipt => storage.workspaces.trashBundle({
    workspaceId: 'ws-trashed', expectedCanvasRevision: trashReceipt.revision, generation: trashReceipt.generation,
    expectedConversations: trashReceipt.conversationState,
  }));
  await stageImport('ws-trashed');
  const results = await recoverInterruptedWorkspaceImports(root, storage);
  expect(results).toEqual(expect.arrayContaining([
    { workspaceId: 'ws-published', outcome: 'cleaned' },
    expect.objectContaining({ workspaceId: 'ws-trashed', outcome: 'cleaned' }),
  ]));
  expect((await readManifest()).workspaces).toEqual([...manifest.workspaces, { id: 'ws-published', name: 'Renamed by user' }]);
  expect(await readdir(join(root, 'ws-trashed'))).toEqual(['nodes', 'note.md']);
});

it('moves an import that never reached SQL aside without deleting its files', async () => {
  await stageImport('ws-uncommitted', { schemaVersion: 1, workspaceId: 'ws-uncommitted', workspaceName: 'Never', phase: 'prepared' });
  const [result] = await recoverInterruptedWorkspaceImports(root, storage);
  expect(result).toMatchObject({ workspaceId: 'ws-uncommitted', outcome: 'set-aside' });
  expect(await readdir(root)).not.toContain('ws-uncommitted');
  expect(await readFile(join(result.detail!, 'note.md'), 'utf8')).toBe('notes for ws-uncommitted');
  expect(await readManifest()).toEqual(manifest);
  expect(await storage.canvas.read('ws-uncommitted')).toBeNull();
});

it('leaves untrustworthy journals and their workspaces untouched', async () => {
  await commit('ws-broken');
  await stageImport('ws-broken', '{not json');
  await stageImport('ws-mismatch', { schemaVersion: 1, workspaceId: 'other', workspaceName: 'X' });
  const results = await recoverInterruptedWorkspaceImports(root, storage);
  expect(results).toEqual(expect.arrayContaining([
    { workspaceId: 'ws-broken', outcome: 'skipped', detail: 'invalid JSON' },
    { workspaceId: 'ws-mismatch', outcome: 'skipped', detail: 'journal does not match its directory' },
  ]));
  expect(await readdir(join(root, 'ws-broken'))).toContain(IMPORT_JOURNAL);
  expect(await readdir(root)).toContain('ws-mismatch');
  expect(await readManifest()).toEqual(manifest);
});
