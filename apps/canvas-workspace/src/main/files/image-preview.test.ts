import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lookupImagePreview, storeImagePreview } from './image-preview';

const rendered = {
  png: new Uint8Array(Buffer.from('preview-png')),
  width: 960,
  height: 720,
  originalWidth: 4000,
  originalHeight: 3000,
};

describe('image preview cache', () => {
  let dir: string;
  let sourcePath: string;
  let cacheDir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'canvas-image-preview-'));
    sourcePath = join(dir, 'large.png');
    cacheDir = join(dir, 'cache');
    await writeFile(sourcePath, Buffer.from('original-image'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const requestKey = async (): Promise<string> => {
    const found = await lookupImagePreview(sourcePath, { cacheDir, maxDimension: 960 });
    if (!('request' in found)) throw new Error('expected a cache miss');
    return found.request.cacheKey;
  };

  it('asks for a render on a miss and serves the stored preview afterwards', async () => {
    const missed = await lookupImagePreview(sourcePath, { cacheDir, maxDimension: 960 });
    expect(missed).toMatchObject({ request: { maxDimension: 960 } });

    const stored = await storeImagePreview(sourcePath, await requestKey(), rendered, { cacheDir });
    const hit = await lookupImagePreview(sourcePath, { cacheDir, maxDimension: 960 });

    expect(stored).toMatchObject({
      generated: true,
      width: 960,
      height: 720,
      originalWidth: 4000,
      originalHeight: 3000,
    });
    expect(hit).toEqual({ preview: stored });
    expect(await readFile(stored.path)).toEqual(Buffer.from('preview-png'));
  });

  it('caches a small source as its own path so it is not decoded again', async () => {
    const small = { width: 640, height: 480, originalWidth: 640, originalHeight: 480 };
    const stored = await storeImagePreview(sourcePath, await requestKey(), small, { cacheDir });

    expect(stored).toEqual({ path: sourcePath, generated: false, ...small });
    expect(await lookupImagePreview(sourcePath, { cacheDir, maxDimension: 960 })).toEqual({ preview: stored });
  });

  it('invalidates the old preview when the source file changes', async () => {
    const first = await storeImagePreview(sourcePath, await requestKey(), rendered, { cacheDir });
    await writeFile(sourcePath, Buffer.from('replacement-image-with-a-different-size'));
    const future = new Date(Date.now() + 2_000);
    await utimes(sourcePath, future, future);

    const second = await storeImagePreview(sourcePath, await requestKey(), rendered, { cacheDir });

    expect(second.path).not.toBe(first.path);
    await expect(stat(first.path)).rejects.toThrow();
  });

  it('rejects a render whose source changed after the lookup', async () => {
    const staleKey = await requestKey();
    await writeFile(sourcePath, Buffer.from('replacement-image-with-a-different-size'));

    await expect(storeImagePreview(sourcePath, staleKey, rendered, { cacheDir }))
      .rejects.toThrow('Image changed');
  });

  it('rejects a key that could name a path outside the cache', async () => {
    await expect(storeImagePreview(sourcePath, '../escape', rendered, { cacheDir }))
      .rejects.toThrow('Invalid image preview key');
  });
});
