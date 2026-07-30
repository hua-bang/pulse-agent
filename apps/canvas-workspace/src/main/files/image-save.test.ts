import { access, mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { deleteSavedImage, MAX_SAVED_IMAGE_BYTES, saveBase64Image } from './image-save';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe('saveBase64Image', () => {
  it('does not overwrite images saved in the same millisecond', async () => {
    const storeDir = await mkdtemp(join(tmpdir(), 'canvas-image-save-'));
    tempDirs.push(storeDir);
    const now = () => 42;
    const [first, second] = await Promise.all([
      saveBase64Image({
        storeDir,
        workspaceId: 'workspace-a',
        data: Buffer.from('first').toString('base64'),
        ext: 'jpeg',
        now,
        uuid: () => 'first-id',
      }),
      saveBase64Image({
        storeDir,
        workspaceId: 'workspace-a',
        data: Buffer.from('second').toString('base64'),
        ext: 'jpeg',
        now,
        uuid: () => 'second-id',
      }),
    ]);

    expect(first.filePath).not.toBe(second.filePath);
    expect(first.fileName.endsWith('.jpg')).toBe(true);
    expect(await readFile(first.filePath, 'utf8')).toBe('first');
    expect(await readFile(second.filePath, 'utf8')).toBe('second');
  });

  it('rejects decoded payloads over the host limit', async () => {
    const storeDir = await mkdtemp(join(tmpdir(), 'canvas-image-save-'));
    tempDirs.push(storeDir);
    await expect(saveBase64Image({
      storeDir,
      workspaceId: 'workspace-a',
      data: Buffer.alloc(MAX_SAVED_IMAGE_BYTES + 1).toString('base64'),
    })).rejects.toThrow('12 MB');
  });

  it('deletes only generated images inside the owning workspace', async () => {
    const storeDir = await mkdtemp(join(tmpdir(), 'canvas-image-save-'));
    tempDirs.push(storeDir);
    const saved = await saveBase64Image({
      storeDir,
      workspaceId: 'workspace-a',
      data: Buffer.from('temporary').toString('base64'),
    });

    await deleteSavedImage({
      storeDir,
      workspaceId: 'workspace-a',
      filePath: saved.filePath,
    });
    await expect(access(saved.filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(deleteSavedImage({
      storeDir,
      workspaceId: 'workspace-a',
      filePath: join(storeDir, 'outside.png'),
    })).rejects.toThrow(/outside this workspace/);
    await expect(saveBase64Image({
      storeDir,
      workspaceId: '../outside',
      data: Buffer.from('escape').toString('base64'),
    })).rejects.toThrow(/Invalid workspace/);
  });
});
