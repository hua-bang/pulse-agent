import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  collectExternalFilePaths,
  collectExternalWorkspaceFiles,
} from '../canvas/workspace-export-external-files';

let root: string;
let workspaceDir: string;
let externalDir: string;

beforeEach(async () => {
  root = join(tmpdir(), `workspace-external-files-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  workspaceDir = join(root, 'workspace');
  externalDir = join(root, 'outside');
  await fs.mkdir(workspaceDir, { recursive: true });
  await fs.mkdir(externalDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('workspace export external files', () => {
  it('finds absolute file paths outside the workspace only', async () => {
    const internalPath = join(workspaceDir, 'inside.txt');
    const externalPath = join(externalDir, 'outside.txt');
    await fs.writeFile(internalPath, 'inside');
    await fs.writeFile(externalPath, 'outside');

    const paths = collectExternalFilePaths({
      nodes: [
        { data: { filePath: internalPath } },
        { data: { nested: { filePath: externalPath } } },
        { data: { filePath: 'pulsecanvas://workspace/notes.txt' } },
      ],
    }, workspaceDir);

    expect(paths).toEqual([externalPath]);
  });

  it('copies readable external files into archive entries and maps their original paths', async () => {
    const externalPath = join(externalDir, 'outside.txt');
    await fs.writeFile(externalPath, 'portable content');

    const bundle = await collectExternalWorkspaceFiles([externalPath, join(externalDir, 'missing.txt')], []);

    expect(bundle.files).toHaveLength(1);
    expect(bundle.files[0].relativePath).toBe('__external_files__/001-outside.txt');
    expect(Buffer.from(bundle.files[0].content, 'base64').toString('utf-8')).toBe('portable content');
    expect(bundle.pathMap.get(externalPath)).toBe('__external_files__/001-outside.txt');
    expect(bundle.skipped).toHaveLength(1);
  });
});
