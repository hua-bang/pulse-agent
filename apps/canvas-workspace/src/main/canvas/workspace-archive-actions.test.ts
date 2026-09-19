import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseWorkspaceExportFile } from './workspace-export-archive';
import { exportWorkspaceWithDialog, importWorkspaceWithDialog } from './workspace-archive-actions';

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(), showOpenDialog: vi.fn(), source: vi.fn(),
}));
vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: { showSaveDialog: mocks.showSaveDialog, showOpenDialog: mocks.showOpenDialog },
}));
vi.mock('./persistence/sqlite-workspace', async (original) => ({
  ...await original<typeof import('./persistence/sqlite-workspace')>(),
  readWorkspaceExportSource: mocks.source,
}));
const roots: string[] = [];
beforeEach(() => { vi.clearAllMocks(); });
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe('lazy workspace archive actions', () => {
  it('exports the same portable archive only after the save dialog succeeds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pulse-workspace-export-action-'));
    roots.push(root);
    const filePath = join(root, 'result.zip');
    const canvas = { nodes: [{ id: 'note', type: 'file', data: { filePath: join(root, 'ws', 'notes', 'note.md') } }] };
    const files = [{ relativePath: 'notes/note.md', encoding: 'base64', content: Buffer.from('preserved').toString('base64') }];
    mocks.source.mockResolvedValue({ canvas, files });
    mocks.showSaveDialog.mockResolvedValue({ canceled: false, filePath });
    const legacy = vi.fn();
    expect(await exportWorkspaceWithDialog(root, { id: 'ws', name: 'Board' }, legacy)).toMatchObject({ ok: true, filePath, fileCount: 1 });
    expect(mocks.source).toHaveBeenCalledWith(root, 'ws', legacy);
    const exported = parseWorkspaceExportFile(await readFile(filePath));
    expect(exported.canvas).toMatchObject({ nodes: [{ data: { filePath: 'pulsecanvas://workspace/notes/note.md' } }] });
    expect(exported.files).toEqual(files);
  });

  it('preserves cancellation without invoking import', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const importer = vi.fn();
    expect(await importWorkspaceWithDialog(importer)).toEqual({ ok: false, canceled: true });
    expect(importer).not.toHaveBeenCalled();
  });

  it('returns the existing import receipt without its internal canvas payload', async () => {
    mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/temporary/board.zip'] });
    const importer = vi.fn(async () => ({ workspaceId: 'new', workspaceName: 'Board', fileCount: 2, canvas: { nodes: [] } }));
    expect(await importWorkspaceWithDialog(importer)).toEqual({ ok: true, workspaceId: 'new', workspaceName: 'Board', fileCount: 2 });
    expect(importer).toHaveBeenCalledWith('/temporary/board.zip');
  });
});
