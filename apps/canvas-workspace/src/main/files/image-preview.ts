import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ImagePreview, RenderedImagePreview } from '../../shared/api/files';

// Previews are decoded and scaled in a renderer worker. Decoding a large image
// with nativeImage here blocked the main event loop for about 100 ms per image,
// so the main process only owns the cache: lookup, atomic writes, and cleanup.

/** Cache miss: the caller renders the preview and returns it with this key. */
export interface ImagePreviewRequest {
  cacheKey: string;
  maxDimension: number;
}

interface ImagePreviewOptions {
  cacheDir: string;
  maxDimension?: number;
}

const CACHE_KEY_PATTERN = /^[0-9a-f]{20}-[0-9a-f]{12}-\d+$/;

const sourceCachePrefix = (filePath: string): string => (
  createHash('sha256').update(resolve(filePath)).digest('hex').slice(0, 20)
);

const normalizeMaxDimension = (value: number | undefined): number => (
  Math.max(1, Math.round(value ?? 960))
);

const cacheKeyFor = async (filePath: string, maxDimension: number): Promise<string> => {
  const sourceStat = await fs.stat(filePath);
  const fingerprint = createHash('sha256')
    .update(`${sourceStat.size}:${sourceStat.mtimeMs}`)
    .digest('hex')
    .slice(0, 12);
  return `${sourceCachePrefix(filePath)}-${fingerprint}-${maxDimension}`;
};

const cachePaths = (cacheDir: string, cacheKey: string) => ({
  previewFileName: `${cacheKey}.png`,
  metadataFileName: `${cacheKey}.png.json`,
  previewPath: join(cacheDir, `${cacheKey}.png`),
  metadataPath: join(cacheDir, `${cacheKey}.png.json`),
});

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

// A source that needs no smaller preview is cached as metadata only, so it is
// not decoded again on every load.
const readCachedPreview = async (
  filePath: string,
  previewPath: string,
  metadataPath: string,
): Promise<ImagePreview | null> => {
  try {
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as ImagePreview;
    if (!metadata.generated) return metadata.path === filePath ? metadata : null;
    if (metadata.path !== previewPath) return null;
    await fs.stat(previewPath);
    return metadata;
  } catch {
    return null;
  }
};

const writeAtomically = async (path: string, data: Uint8Array | string): Promise<void> => {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporaryPath, data);
  await fs.rename(temporaryPath, path).catch(async (error) => {
    await fs.rm(temporaryPath, { force: true });
    const exists = await fs.stat(path).then(() => true).catch(() => false);
    if (!exists) throw error;
  });
};

export const lookupImagePreview = async (
  filePath: string,
  options: ImagePreviewOptions,
): Promise<{ preview: ImagePreview } | { request: ImagePreviewRequest }> => {
  const maxDimension = normalizeMaxDimension(options.maxDimension);
  const cacheKey = await cacheKeyFor(filePath, maxDimension);
  const paths = cachePaths(options.cacheDir, cacheKey);
  const cached = await readCachedPreview(filePath, paths.previewPath, paths.metadataPath);
  if (!cached) return { request: { cacheKey, maxDimension } };
  await removeStalePreviews(
    options.cacheDir,
    filePath,
    new Set([paths.previewFileName, paths.metadataFileName]),
  );
  return { preview: cached };
};

export const storeImagePreview = async (
  filePath: string,
  cacheKey: string,
  rendered: RenderedImagePreview,
  options: ImagePreviewOptions,
): Promise<ImagePreview> => {
  if (!CACHE_KEY_PATTERN.test(cacheKey)) throw new Error('Invalid image preview key');
  const maxDimension = Number(cacheKey.slice(cacheKey.lastIndexOf('-') + 1));
  // The source changed after the lookup: the rendered preview is stale.
  if (await cacheKeyFor(filePath, maxDimension) !== cacheKey) {
    throw new Error('Image changed while its preview was rendered');
  }
  const paths = cachePaths(options.cacheDir, cacheKey);
  const generated = Boolean(rendered.png?.length);
  const result: ImagePreview = {
    path: generated ? paths.previewPath : filePath,
    generated,
    width: generated ? rendered.width : rendered.originalWidth,
    height: generated ? rendered.height : rendered.originalHeight,
    originalWidth: rendered.originalWidth,
    originalHeight: rendered.originalHeight,
  };
  await fs.mkdir(options.cacheDir, { recursive: true });
  if (generated && rendered.png) await writeAtomically(paths.previewPath, rendered.png);
  await writeAtomically(paths.metadataPath, JSON.stringify(result));
  await removeStalePreviews(
    options.cacheDir,
    filePath,
    new Set([paths.previewFileName, paths.metadataFileName]),
  );
  return result;
};
