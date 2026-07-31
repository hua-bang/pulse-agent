import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path';

export const MAX_SAVED_IMAGE_BYTES = 12 * 1024 * 1024;

const sanitizeImageExtension = (value?: string): string => {
  const normalized = (value ?? 'png')
    .toLowerCase()
    .replace(/^image\//, '')
    .replace(/[^a-z0-9]/g, '');
  if (!normalized) return 'png';
  return normalized === 'jpeg' ? 'jpg' : normalized;
};

const workspaceImagesDir = (storeDir: string, workspaceId: string): string => {
  const root = resolve(storeDir);
  const imagesDir = resolve(root, workspaceId, 'images');
  const child = relative(root, imagesDir);
  if (!child || child.startsWith('..') || isAbsolute(child)) {
    throw new Error('Invalid workspace image directory');
  }
  return imagesDir;
};

export async function saveBase64Image(options: {
  storeDir: string;
  workspaceId: string;
  data: string;
  ext?: string;
  now?: () => number;
  uuid?: () => string;
}) {
  const buffer = Buffer.from(options.data, 'base64');
  if (buffer.byteLength > MAX_SAVED_IMAGE_BYTES) {
    throw new Error('Image exceeds the 12 MB limit');
  }
  const imagesDir = workspaceImagesDir(options.storeDir, options.workspaceId);
  await fs.mkdir(imagesDir, { recursive: true });
  const ext = sanitizeImageExtension(options.ext);
  const fileName = `img-${(options.now ?? Date.now)()}-${(options.uuid ?? randomUUID)()}.${ext}`;
  const filePath = join(imagesDir, fileName);
  await fs.writeFile(filePath, buffer, { flag: 'wx' });
  return { filePath, fileName };
}

export async function deleteSavedImage(options: {
  storeDir: string;
  workspaceId: string;
  filePath: string;
}): Promise<void> {
  const imagesDir = workspaceImagesDir(options.storeDir, options.workspaceId);
  const filePath = resolve(options.filePath);
  if (dirname(filePath) !== imagesDir || !basename(filePath).startsWith('img-')) {
    throw new Error('Refusing to delete an image outside this workspace');
  }
  await fs.unlink(filePath);
}
