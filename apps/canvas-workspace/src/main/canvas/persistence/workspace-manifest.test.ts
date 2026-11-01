import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PulseStorage } from '@pulse-coder/storage';
import { activateLocalCanvasStorage } from '@pulse-coder/storage/local';
import { closeCanvasStorage, getLocalCanvasStorage } from './backend';
import { readWorkspaceManifestDocument, updateWorkspaceManifestDocument } from './workspace-manifest';
import { saveWorkspaceManifest } from './workspace-trash';
import { setCanvasSessionArchivePort } from './session-archive-port';
import { readRendererWorkspaceManifest } from '../workspaces';

let root: string;
let storage: PulseStorage | undefined;
const manifestFile = () => join(root, '__workspaces__.json');
const legacy = {
  workspaces: [
    { id: 'work', name: 'Work', rootFolder: '/project', folderId: 'missing-folder', plugin: { keep: true } },
    { id: 'gone', name: 'Gone' },
  ],
  folders: [{ id: 'f', name: 'Folder', extra: 1 }],
  activeId: 'gone',
  futureKey: ['kept'],
};

async function activate() {
  storage = await activateLocalCanvasStorage({ root, loadLegacyWorkspaces: async () => ['work', 'gone'].map(id => ({
    workspaceId: id, metadata: {}, nodes: [], placements: [], edges: [],
  })) });
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pulse-app-workspace-manifest-'));
  setCanvasSessionArchivePort({
    assertWorkspaceStorage: async () => undefined,
    withWorkspaceTrashGuard: async (_id, operation) => operation(),
    exportFiles: () => [],
    prepareImport: (_id, files) => ({ files, currentSessionId: null, conversations: [] }),
    rewriteAttachmentPaths: files => files,
    attachmentPaths: () => [],
  });
});

afterEach(async () => {
  setCanvasSessionArchivePort(null);
  await closeCanvasStorage();
  await storage?.close();
  storage = undefined;
  await rm(root, { recursive: true, force: true });
});

describe('App workspace manifest authority', () => {
  it('imports the file once without trashed ids, then ignores later file edits', async () => {
    await activate();
    await writeFile(manifestFile(), JSON.stringify(legacy));
    // Trashed before the first manifest read (for example by a CLI on this store).
    const bundle = (await storage!.workspaces.readBundle('gone'))!;
    await storage!.workspaces.trashBundle({
      workspaceId: 'gone', expectedCanvasRevision: bundle.canvas.revision, generation: storage!.generation,
      expectedConversations: bundle.conversationState, metadata: { id: 'gone', name: 'Gone' },
    });
    const imported = await readWorkspaceManifestDocument(root);
    expect(imported).toEqual({ ...legacy, workspaces: [legacy.workspaces[0]], activeId: 'work' });
    // An older build, or a stale backup, rewrites the file after cutover.
    await writeFile(manifestFile(), JSON.stringify({ workspaces: [{ id: 'gone', name: 'Resurrected' }], activeId: 'gone' }));
    expect(await readWorkspaceManifestDocument(root)).toEqual(imported);
    const view = await readRendererWorkspaceManifest(root);
    expect(view).toMatchObject({ kind: 'ok', data: { activeId: 'work', workspaces: [{ id: 'work', name: 'Work' }] } });
  });

  it('saves renderer changes to the database and mirrors them to the file', async () => {
    await activate();
    await writeFile(manifestFile(), JSON.stringify(legacy));
    await saveWorkspaceManifest(root, { workspaces: [{ id: 'work', name: 'Renamed' }], activeId: 'work' });
    const document = await readWorkspaceManifestDocument(root);
    expect(document).toMatchObject({ futureKey: ['kept'], activeId: 'work' });
    expect((document.workspaces as Array<{ name: string }>).map(item => item.name)).toEqual(['Renamed', 'Gone']);
    expect(JSON.parse(await readFile(manifestFile(), 'utf8'))).toEqual(document);
    expect((await (await getLocalCanvasStorage(root))!.workspaceManifest.read())?.revision).toBe(2);
  });

  it('applies each update to the latest committed document', async () => {
    await activate();
    await updateWorkspaceManifestDocument(root, current => ({ ...current, workspaces: [{ id: 'work', name: 'One' }] }));
    await updateWorkspaceManifestDocument(root, current => ({
      ...current, workspaces: [...(current.workspaces as unknown[]), { id: 'gone', name: 'Two' }],
    }));
    expect((await readWorkspaceManifestDocument(root)).workspaces).toEqual([{ id: 'work', name: 'One' }, { id: 'gone', name: 'Two' }]);
  });

  it('keeps a legacy store on the file and never creates a database', async () => {
    await writeFile(manifestFile(), JSON.stringify(legacy));
    await saveWorkspaceManifest(root, { workspaces: [{ id: 'work', name: 'Legacy rename' }] });
    expect(JSON.parse(await readFile(manifestFile(), 'utf8')).workspaces).toEqual([{ id: 'work', name: 'Legacy rename' }]);
    expect((await readWorkspaceManifestDocument(root)).futureKey).toEqual(['kept']);
    await expect(stat(join(root, '__storage__.sqlite'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
