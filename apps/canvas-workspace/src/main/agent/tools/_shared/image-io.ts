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
