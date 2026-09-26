import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openSqliteStorage } from '@pulse-coder/storage/sqlite';
import { prepareLocalFileWrite } from '@pulse-coder/storage/local-files';
import type { PulseStorage } from '@pulse-coder/storage';
import { readTextFile } from '../../files/file-save';

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }));
import { reconcileMarkdownIndex, stopMarkdownIndexWatchers } from './markdown-index';

let root: string;
let store: PulseStorage;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'markdown-index-'));
  store = await openSqliteStorage({ path: join(root, 'store.sqlite') });
});
afterEach(async () => {
  stopMarkdownIndexWatchers();
  await store.close();
  await rm(root, { recursive: true, force: true });
});

describe('Markdown source reconciliation', () => {
  it('treats a bare digest stored by earlier releases as the current file version', async () => {
    const filePath = join(root, 'note.md');
    await writeFile(filePath, 'same content');
    const version = (await readTextFile(filePath)).version!;
    expect(version).toMatch(/^sha256:/);
    const legacy = version.slice('sha256:'.length);
    await store.canvas.commit({
      workspaceId: 'ws', expectedRevision: null,
      nodes: { put: [{
        id: 'n', type: 'file', fileSource: { version: legacy, conflict: false },
        data: { filePath, content: 'same content', modified: false, saved: true },
      }] },
    });
    const revision = (await store.canvas.read('ws'))!.revision;
    const result = await reconcileMarkdownIndex(store, 'ws');
    expect(result.files).toEqual([]);
    expect((await store.canvas.read('ws'))!.revision).toBe(revision);
  });

  it('refreshes an outdated cache from the source file and avoids repeat writes', async () => {
    const filePath = join(root, 'note.md');
    await writeFile(filePath, 'disk wins');
    await store.canvas.commit({
      workspaceId: 'ws', expectedRevision: null,
      nodes: { put: [{ id: 'n', type: 'file', data: { filePath, content: 'old cache', modified: false } }] },
    });
    const first = await reconcileMarkdownIndex(store, 'ws');
    expect(first.files[0].content).toBe('disk wins');
    expect((await store.canvas.readNode('ws', 'n'))?.data).toMatchObject({ content: 'disk wins', saved: true });
    const revision = (await store.canvas.read('ws'))!.revision;
    await reconcileMarkdownIndex(store, 'ws');
    expect((await store.canvas.read('ws'))!.revision).toBe(revision);
    await writeFile(filePath, 'external editor');
    await reconcileMarkdownIndex(store, 'ws');
    expect((await store.canvas.readNode('ws', 'n'))?.data).toMatchObject({ content: 'external editor' });
  });

  it('keeps dirty drafts when the external file differs', async () => {
    const filePath = join(root, 'note.md');
    await writeFile(filePath, 'external content');
    await store.canvas.commit({
      workspaceId: 'ws', expectedRevision: null,
      nodes: { put: [{ id: 'n', type: 'file', data: { filePath, content: 'unsaved draft', modified: true } }] },
    });
    await reconcileMarkdownIndex(store, 'ws');
    const node = await store.canvas.readNode('ws', 'n');
    expect(node?.data).toMatchObject({ content: 'unsaved draft', modified: true });
    expect(node?.fileSource).toMatchObject({ conflict: true });
  });

  it('does not override a pending recoverable write or an unavailable file', async () => {
    const filePath = join(root, 'note.md');
    await writeFile(filePath, 'base');
    await store.canvas.commit({
      workspaceId: 'ws', expectedRevision: null,
      nodes: { put: [
        { id: 'pending', type: 'file', data: { filePath, content: 'target', fileWriteIntentId: 'intent', fileWriteStatus: 'pending' } },
        { id: 'missing', type: 'file', data: { filePath: join(root, 'missing.md'), content: 'recoverable' } },
      ] },
    });
    await reconcileMarkdownIndex(store, 'ws');
    expect((await store.canvas.readNode('ws', 'pending'))?.data).toMatchObject({ content: 'target' });
    expect((await store.canvas.readNode('ws', 'missing'))?.data).toMatchObject({ content: 'recoverable' });
  });

  it('marks an imported missing intent as a draft even when its cached source version already matches', async () => {
    const filePath = join(root, 'note.md');
    await writeFile(filePath, 'disk body');
    const version = (await readTextFile(filePath)).version!;
    await store.canvas.commit({
      workspaceId: 'ws', expectedRevision: null,
      nodes: { put: [{
        id: 'n', type: 'file', fileSource: { version, conflict: false, future: 'preserved' },
        data: { filePath, content: 'imported draft', modified: false, fileWriteIntentId: 'missing-old-id', fileWriteStatus: 'pending' },
      }] },
    });
    await reconcileMarkdownIndex(store, 'ws');
    const node = (await store.canvas.readNode('ws', 'n'))!;
    expect(node.data).toMatchObject({ content: 'imported draft', modified: true, saved: false });
    expect(node.data).not.toHaveProperty('fileWriteIntentId');
    expect(node.data).not.toHaveProperty('fileWriteStatus');
    expect(node.fileSource).toEqual({ version, conflict: true, future: 'preserved' });
    const revision = (await store.canvas.read('ws'))!.revision;
    await reconcileMarkdownIndex(store, 'ws');
    expect((await store.canvas.read('ws'))!.revision).toBe(revision);
  });

  it.each(['pending', 'conflict', 'error'] as const)('uses the actual %s intent instead of a stale applied node flag', async status => {
    const filePath = join(root, 'note.md');
    await writeFile(filePath, 'base');
    const intent = await prepareLocalFileWrite(filePath, 'n', 'target draft');
    await store.canvas.commit({
      workspaceId: 'ws', expectedRevision: null,
      nodes: { put: [{ id: 'n', type: 'file', data: { filePath, content: intent.content } }] },
      fileWrites: [intent],
    });
    if (status !== 'pending') await store.fileWrites.settle(intent.id, { status });
    const snapshot = (await store.canvas.read('ws'))!;
    await store.canvas.commit({
      workspaceId: 'ws', expectedRevision: snapshot.revision, expectedGeneration: snapshot.generation,
      nodes: { put: [{
        ...snapshot.nodes[0],
        data: { filePath, content: intent.content, fileWriteIntentId: intent.id, fileWriteStatus: 'applied', modified: false, saved: true },
      }] },
    });
    await reconcileMarkdownIndex(store, 'ws');
    expect((await store.canvas.readNode('ws', 'n'))?.data).toMatchObject({
      content: 'target draft', fileWriteIntentId: intent.id, fileWriteStatus: status, modified: true, saved: false,
    });
  });

  it('cleans completed imported intent metadata and resumes external refresh', async () => {
    const filePath = join(root, 'note.md');
    await writeFile(filePath, 'external body');
    const version = (await readTextFile(filePath)).version!;
    await store.canvas.commit({
      workspaceId: 'ws', expectedRevision: null,
      nodes: { put: [{
        id: 'n', type: 'file', fileSource: { version, conflict: true },
        data: { filePath, content: 'previous applied body', modified: false, fileWriteIntentId: 'old-applied-id', fileWriteStatus: 'applied' },
      }] },
    });
    await reconcileMarkdownIndex(store, 'ws');
    const node = (await store.canvas.readNode('ws', 'n'))!;
    expect(node.data).toMatchObject({ content: 'external body', modified: false, saved: true });
    expect(node.data).not.toHaveProperty('fileWriteIntentId');
    expect(node.data).not.toHaveProperty('fileWriteStatus');
    expect(node.fileSource).toMatchObject({ conflict: false });
    await writeFile(filePath, 'another external edit');
    await reconcileMarkdownIndex(store, 'ws');
    expect((await store.canvas.readNode('ws', 'n'))?.data).toMatchObject({ content: 'another external edit' });
  });

  it('retains an orphaned draft when the source file is unavailable', async () => {
    await store.canvas.commit({
      workspaceId: 'ws', expectedRevision: null,
      nodes: { put: [{
        id: 'n', type: 'file', data: {
          filePath: join(root, 'missing.md'), content: 'only surviving draft',
          fileWriteIntentId: 'lost-intent', fileWriteStatus: 'error', modified: false,
        },
      }] },
    });
    await reconcileMarkdownIndex(store, 'ws');
    const node = (await store.canvas.readNode('ws', 'n'))!;
    expect(node.data).toMatchObject({ content: 'only surviving draft', modified: true, saved: false });
    expect(node.data).not.toHaveProperty('fileWriteIntentId');
    expect(node.fileSource).toMatchObject({ conflict: true });
  });

  it('clears an old conflict after the user reloads identical disk content without a new file version', async () => {
    const filePath = join(root, 'note.md');
    await writeFile(filePath, 'disk');
    const version = (await readTextFile(filePath)).version!;
    await store.canvas.commit({
      workspaceId: 'ws', expectedRevision: null,
      nodes: { put: [{
        id: 'n', type: 'file', fileSource: { version, conflict: true },
        data: { filePath, content: 'disk', modified: false, saved: true },
      }] },
    });
    await reconcileMarkdownIndex(store, 'ws');
    expect((await store.canvas.readNode('ws', 'n'))?.fileSource).toEqual({ version, conflict: false });
  });
});
