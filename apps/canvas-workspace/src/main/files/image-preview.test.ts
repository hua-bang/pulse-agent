import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const imageMock = vi.hoisted(() => {
  let empty = false;
  const resize = vi.fn(() => ({
    getSize: () => ({ width: 960, height: 720 }),
    toPNG: () => Buffer.from('preview-png'),
  }));
  const createFromPath = vi.fn(() => ({
    isEmpty: () => empty,
    getSize: () => empty ? { width: 0, height: 0 } : { width: 4000, height: 3000 },
    resize,
  }));
  return {
    createFromPath,
    resize,
    setEmpty: (value: boolean) => { empty = value; },
  };
});

vi.mock('electron', () => ({
  nativeImage: { createFromPath: imageMock.createFromPath },
}));

import { ensureImagePreview } from './image-preview';

describe('ensureImagePreview', () => {
  let dir: string;
  let sourcePath: string;
  let cacheDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'canvas-image-preview-'));
    sourcePath = join(dir, 'large.png');
    cacheDir = join(dir, 'cache');
    await writeFile(sourcePath, Buffer.from('original-image'));
    imageMock.setEmpty(false);
    imageMock.resize.mockClear();
    imageMock.createFromPath.mockClear();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('creates and reuses a bounded preview for a large source image', async () => {
    const first = await ensureImagePreview(sourcePath, { cacheDir, maxDimension: 960 });
    const second = await ensureImagePreview(sourcePath, { cacheDir, maxDimension: 960 });

    expect(first).toMatchObject({
      generated: true,
      width: 960,
      height: 720,
      originalWidth: 4000,
      originalHeight: 3000,
    });
    expect(first.path).toBe(second.path);
    expect(await readFile(first.path)).toEqual(Buffer.from('preview-png'));
    expect(imageMock.resize).toHaveBeenCalledTimes(1);
    expect(imageMock.createFromPath).toHaveBeenCalledTimes(1);
    expect(imageMock.resize).toHaveBeenCalledWith({ width: 960, height: 720, quality: 'good' });
  });

  it('invalidates the old sidecar when the source file changes', async () => {
    const first = await ensureImagePreview(sourcePath, { cacheDir, maxDimension: 960 });
    await writeFile(sourcePath, Buffer.from('replacement-image-with-a-different-size'));
    const future = new Date(Date.now() + 2_000);
    await utimes(sourcePath, future, future);

    const second = await ensureImagePreview(sourcePath, { cacheDir, maxDimension: 960 });

    expect(second.path).not.toBe(first.path);
    await expect(stat(first.path)).rejects.toThrow();
    expect(imageMock.resize).toHaveBeenCalledTimes(2);
  });

  it('falls back to the original image when Electron cannot decode it', async () => {
    imageMock.setEmpty(true);

    await expect(ensureImagePreview(sourcePath, { cacheDir, maxDimension: 960 })).resolves.toEqual({
      path: sourcePath,
      generated: false,
      width: 0,
      height: 0,
      originalWidth: 0,
      originalHeight: 0,
    });
  });
});
