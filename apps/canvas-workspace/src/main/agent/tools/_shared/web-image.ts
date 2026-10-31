import { promises as fs } from 'fs';
import { join } from 'path';
import { STORE_DIR } from './canvas-io';

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 20000;
/** Same default cap as pasted images in the renderer (canvasImageFile.ts). */
const MAX_DEFAULT_DIM = 480;

const MIME_TO_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

export interface DownloadedWebImage {
  filePath: string;
  bytes: number;
  /** Pixel size read from the file header; absent for SVG and unknown formats. */
  size?: { width: number; height: number };
}

/**
 * Download a web image into the workspace images folder so an image node
 * can show it offline. Only http(s) URLs and image content types pass.
 */
export async function downloadWebImage(workspaceId: string, rawUrl: string): Promise<DownloadedWebImage> {
  let url: URL;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error(`invalid image URL: ${rawUrl}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`image URL must use http or https: ${rawUrl}`);
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS), redirect: 'follow' });
  if (!response.ok) throw new Error(`image download failed with HTTP ${response.status}: ${url.href}`);

  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = MIME_TO_EXTENSION[mime];
  if (!ext) throw new Error(`URL is not a supported image (content-type "${mime || 'unknown'}"): ${url.href}`);

  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (declaredLength > MAX_IMAGE_BYTES) throw new Error(`image is larger than 15 MB: ${url.href}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`image is larger than 15 MB: ${url.href}`);

  const imagesDir = join(STORE_DIR, workspaceId, 'images');
  await fs.mkdir(imagesDir, { recursive: true });
  const filePath = join(imagesDir, `web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`);
  await fs.writeFile(filePath, buffer);

  const size = readImageSize(buffer);
  return { filePath, bytes: buffer.length, ...(size ? { size } : {}) };
}

/** Fit pixel dimensions into the default on-canvas size, keeping the aspect ratio. */
export function fitImageNodeSize(size: { width: number; height: number }): { width: number; height: number } {
  const largest = Math.max(size.width, size.height);
  if (largest <= MAX_DEFAULT_DIM) return { width: Math.max(40, size.width), height: Math.max(40, size.height) };
  const scale = MAX_DEFAULT_DIM / largest;
  return {
    width: Math.max(40, Math.round(size.width * scale)),
    height: Math.max(40, Math.round(size.height * scale)),
  };
}

/** Read width and height from PNG, GIF, JPEG, or WebP headers. */
export function readImageSize(buffer: Buffer): { width: number; height: number } | undefined {
  const valid = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : undefined);

  if (buffer.length >= 24 && buffer.readUInt32BE(0) === 0x89504e47) {
    return valid(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
  }
  if (buffer.length >= 10 && buffer.toString('ascii', 0, 4) === 'GIF8') {
    return valid(buffer.readUInt16LE(6), buffer.readUInt16LE(8));
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return readJpegSize(buffer);
  }
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8 ') return valid(buffer.readUInt16LE(26) & 0x3fff, buffer.readUInt16LE(28) & 0x3fff);
    if (chunk === 'VP8L') {
      const bits = buffer.readUInt32LE(21);
      return valid((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1);
    }
    if (chunk === 'VP8X') return valid(buffer.readUIntLE(24, 3) + 1, buffer.readUIntLE(27, 3) + 1);
  }
  return undefined;
}

function readJpegSize(buffer: Buffer): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) return undefined;
    const marker = buffer[offset + 1];
    // SOF0-SOF15 carry the frame size; C4 (DHT), C8 (JPG), and CC (DAC) do not.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = buffer.readUInt16BE(offset + 5);
      const width = buffer.readUInt16BE(offset + 7);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return undefined;
}
