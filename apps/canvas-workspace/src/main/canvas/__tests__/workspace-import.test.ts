import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createWorkspaceExportArchive,
  createWorkspaceExportPayload,
} from '../workspace-export-archive';
import { importWorkspaceArchiveToStore } from '../workspace-import';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('importWorkspaceArchiveToStore', () => {
  it('registers a successful import and rewrites portable file paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pulse-canvas-import-'));
    roots.push(root);
    const sourcePath = join(root, 'workspace.pulsecanvas.zip');
    const payload = createWorkspaceExportPayload({
      exportedAt: '2026-07-26T00:00:00.000Z',
      workspace: { id: 'source', name: 'Imported board' },
      canvas: {
        nodes: [{
          id: 'card',
          type: 'file',
          data: { filePath: 'pulsecanvas://workspace/notes/card.md' },
        }],
      },
      files: [{
        relativePath: 'notes/card.md',
        encoding: 'base64',
        content: Buffer.from('# Card').toString('base64'),
      }],
    });
    await writeFile(sourcePath, createWorkspaceExportArchive(payload));
    const storeDir = join(root, 'store');

    const result = await importWorkspaceArchiveToStore({
      sourcePath,
      storeDir,
      workspaceId: 'ws-imported',
      agentsTemplate: '# Agents',
    });

    expect(result.workspaceName).toBe('Imported board');
    const canvas = JSON.parse(await readFile(join(storeDir, 'ws-imported', 'canvas.json'), 'utf8'));
    expect(canvas.nodes[0].data.filePath).toBe(join(storeDir, 'ws-imported', 'notes', 'card.md'));
    const manifest = JSON.parse(await readFile(join(storeDir, '__workspaces__.json'), 'utf8'));
    expect(manifest).toMatchObject({
      activeId: 'ws-imported',
      workspaces: [{ id: 'ws-imported', name: 'Imported board' }],
    });
  });

  it('publishes the workspace only after every archive file is written', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pulse-canvas-import-'));
    roots.push(root);
    const sourcePath = join(root, 'broken.pulsecanvas.zip');
    const payload = createWorkspaceExportPayload({
      exportedAt: '2026-07-26T00:00:00.000Z',
      workspace: { id: 'source', name: 'Broken import' },
      canvas: { nodes: [] },
      files: [
        { relativePath: 'notes', encoding: 'base64', content: Buffer.from('file').toString('base64') },
        { relativePath: 'notes/nested.md', encoding: 'base64', content: Buffer.from('nested').toString('base64') },
      ],
    });
    await writeFile(sourcePath, createWorkspaceExportArchive(payload));
    const storeDir = join(root, 'store');

    await expect(importWorkspaceArchiveToStore({
      sourcePath,
      storeDir,
      workspaceId: 'ws-imported',
      agentsTemplate: '# Agents',
    })).rejects.toThrow();

    expect(await readdir(storeDir)).toEqual([]);
  });
});
