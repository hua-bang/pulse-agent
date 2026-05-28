import { promises as fs } from 'fs';
import { extname } from 'path';

export const IMAGE_EXTENSION_TO_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
};

export function resolveImageMimeType(filePath: string): string {
  return IMAGE_EXTENSION_TO_MIME[extname(filePath).toLowerCase()] ?? 'image/png';
}

export function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24) return null;
  if (buffer.toString('hex', 0, 8) !== '89504e470d0a1a0a') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

export function readJpegDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) return null;
    const marker = buffer[offset + 1];
    const length = buffer.readUInt16BE(offset + 2);
    if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < buffer.length) {
      return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

export async function readImageDimensions(filePath: string): Promise<{ width: number; height: number } | null> {
  try {
    const buffer = await fs.readFile(filePath);
    return readPngDimensions(buffer) ?? readJpegDimensions(buffer);
  } catch {
    return null;
  }
}

export function fitImageNodeDimensions(dimensions: { width: number; height: number } | null): { width: number; height: number } {
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return { width: 480, height: 360 };
  }
  const maxDim = 480;
  const largest = Math.max(dimensions.width, dimensions.height);
  if (largest <= maxDim) return dimensions;
  const scale = maxDim / largest;
  return {
    width: Math.round(dimensions.width * scale),
    height: Math.round(dimensions.height * scale),
  };
}
