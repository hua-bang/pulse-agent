import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { nativeImage } from 'electron';

export interface ImagePreviewResult {
  path: string;
  generated: boolean;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
}

interface ImagePreviewOptions {
  cacheDir: string;
  maxDimension?: number;
}

let generationQueue: Promise<void> = Promise.resolve();

const enqueueGeneration = <T>(task: () => Promise<T>): Promise<T> => {
  const result = generationQueue.then(async () => {
    await new Promise<void>((resolveYield) => setImmediate(resolveYield));
    return task();
  });
  generationQueue = result.then(() => undefined, () => undefined);
  return result;
};

const sourceCachePrefix = (filePath: string): string => (
  createHash('sha256').update(resolve(filePath)).digest('hex').slice(0, 20)
);

const previewFileName = (
  filePath: string,
  size: number,
  mtimeMs: number,
  maxDimension: number,
): string => {
  const fingerprint = createHash('sha256')
    .update(`${size}:${mtimeMs}`)
    .digest('hex')
    .slice(0, 12);
  return `${sourceCachePrefix(filePath)}-${fingerprint}-${maxDimension}.png`;
};

const removeStalePreviews = async (
  cacheDir: string,
  filePath: string,
  keepFileNames: Set<string>,
): Promise<void> => {
  const prefix = `${sourceCachePrefix(filePath)}-`;
  const entries = await fs.readdir(cacheDir).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.startsWith(prefix) && !keepFileNames.has(entry))
    .map((entry) => fs.rm(join(cacheDir, entry), { force: true })));
};

const readCachedPreview = async (
  previewPath: string,
  metadataPath: string,
): Promise<ImagePreviewResult | null> => Promise.all([
  fs.stat(previewPath),
  fs.readFile(metadataPath, 'utf-8').then((value) => JSON.parse(value) as ImagePreviewResult),
]).then(([, metadata]) => (
  metadata?.generated && metadata.path === previewPath ? metadata : null
)).catch(() => null);

export const ensureImagePreview = async (
  filePath: string,
  options: ImagePreviewOptions,
): Promise<ImagePreviewResult> => {
  const maxDimension = Math.max(1, Math.round(options.maxDimension ?? 960));
  const sourceStat = await fs.stat(filePath);
  await fs.mkdir(options.cacheDir, { recursive: true });
  const fileName = previewFileName(filePath, sourceStat.size, sourceStat.mtimeMs, maxDimension);
  const previewPath = join(options.cacheDir, fileName);
  const metadataFileName = `${fileName}.json`;
  const metadataPath = join(options.cacheDir, metadataFileName);
  const cached = await readCachedPreview(previewPath, metadataPath);
  if (cached) {
    await removeStalePreviews(options.cacheDir, filePath, new Set([fileName, metadataFileName]));
    return cached;
  }

  return enqueueGeneration(async () => {
    const queuedCacheHit = await readCachedPreview(previewPath, metadataPath);
    if (queuedCacheHit) return queuedCacheHit;

    const image = nativeImage.createFromPath(filePath);
    const originalSize = image.getSize();
    const fallback: ImagePreviewResult = {
      path: filePath,
      generated: false,
      width: originalSize.width,
      height: originalSize.height,
      originalWidth: originalSize.width,
      originalHeight: originalSize.height,
    };
    if (image.isEmpty() || originalSize.width <= 0 || originalSize.height <= 0) return fallback;
    if (Math.max(originalSize.width, originalSize.height) <= maxDimension) return fallback;

    const scale = maxDimension / Math.max(originalSize.width, originalSize.height);
    const width = Math.max(1, Math.round(originalSize.width * scale));
    const height = Math.max(1, Math.round(originalSize.height * scale));
    const preview = image.resize({ width, height, quality: 'good' });
    if (preview.isEmpty?.()) return fallback;
    const png = preview.toPNG();
    if (png.length === 0) return fallback;
    const temporaryPath = `${previewPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, png);
    await fs.rename(temporaryPath, previewPath).catch(async (error) => {
      await fs.rm(temporaryPath, { force: true });
      const exists = await fs.stat(previewPath).then(() => true).catch(() => false);
      if (!exists) throw error;
    });
    const result: ImagePreviewResult = {
      path: previewPath,
      generated: true,
      width,
      height,
      originalWidth: originalSize.width,
      originalHeight: originalSize.height,
    };
    await fs.writeFile(metadataPath, JSON.stringify(result));
    await removeStalePreviews(options.cacheDir, filePath, new Set([basename(previewPath), metadataFileName]));
    return result;
  });
};
