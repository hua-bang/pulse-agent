import { describe, expect, it } from 'vitest';

import { pngBufferToDataUrl, readClipboardImage, readPlatformClipboardImage } from './clipboard-image.js';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe('pngBufferToDataUrl', () => {
  it('wraps raw PNG bytes in a base64 data URL', () => {
    const dataUrl = pngBufferToDataUrl(PNG_MAGIC);
    expect(dataUrl).toBe(`data:image/png;base64,${PNG_MAGIC.toString('base64')}`);
    // PNG magic (0x89 P N G \r \n 0x1a \n) base64-encodes to iVBORw0KGgo
    // (11 chars; the 12th char already carries the byte AFTER the magic).
    expect(dataUrl.startsWith('data:image/png;base64,iVBORw0KGgo')).toBe(true);
  });
});

describe('readClipboardImage (injected backend)', () => {
  it('returns null when the backend yields no bytes', async () => {
    const backend = async () => Buffer.alloc(0);
    expect(await readClipboardImage('darwin', backend)).toBeNull();
  });

  it('builds a PNG data URL from backend bytes', async () => {
    const backend = async () => PNG_MAGIC;
    const result = await readClipboardImage('darwin', backend);
    expect(result).not.toBeNull();
    expect(result!.mimeType).toBe('image/png');
    expect(result!.dataUrl).toBe(pngBufferToDataUrl(PNG_MAGIC));
  });

  it('rejects images over the byte cap', async () => {
    const backend = async () => Buffer.alloc(5 * 1024 * 1024 + 1);
    await expect(readClipboardImage('darwin', backend)).rejects.toThrow('image too large');
  });

  it('throws for platforms without a backend', async () => {
    await expect(readPlatformClipboardImage('freebsd' as NodeJS.Platform)).rejects.toThrow(
      'clipboard image reading is not supported on freebsd',
    );
  });
});
