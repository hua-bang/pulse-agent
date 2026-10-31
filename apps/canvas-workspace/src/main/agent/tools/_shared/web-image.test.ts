import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORE = '/tmp/canvas-web-image-test';

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn() },
  app: { getPath: () => STORE },
}));

vi.mock('./canvas-io', () => ({ STORE_DIR: '/tmp/canvas-web-image-test' }));

const png = (width: number, height: number) => {
  const buffer = Buffer.alloc(33);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(0x0d0a1a0a, 4);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

const jpeg = (width: number, height: number) => Buffer.from([
  0xff, 0xd8,
  0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
  0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0, 0, 0, 0,
]);

describe('web image download', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(async () => {
    await fs.rm(STORE, { recursive: true, force: true });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reads PNG and JPEG sizes from the header', async () => {
    const { readImageSize } = await import('./web-image');
    expect(readImageSize(png(1600, 900))).toEqual({ width: 1600, height: 900 });
    expect(readImageSize(jpeg(640, 480))).toEqual({ width: 640, height: 480 });
    expect(readImageSize(Buffer.from('<svg/>'))).toBeUndefined();
  });

  it('fits large images into the default node size', async () => {
    const { fitImageNodeSize } = await import('./web-image');
    expect(fitImageNodeSize({ width: 1600, height: 900 })).toEqual({ width: 480, height: 270 });
    expect(fitImageNodeSize({ width: 200, height: 100 })).toEqual({ width: 200, height: 100 });
  });

  it('saves the image into the workspace images folder', async () => {
    globalThis.fetch = vi.fn(async () => new Response(png(1200, 600), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })) as unknown as typeof fetch;
    const { downloadWebImage } = await import('./web-image');

    const result = await downloadWebImage('ws-1', 'https://example.com/chart.png');

    expect(result.filePath.startsWith(`${STORE}/ws-1/images/web-`)).toBe(true);
    expect(result.filePath.endsWith('.png')).toBe(true);
    expect(result.size).toEqual({ width: 1200, height: 600 });
    expect((await fs.readFile(result.filePath)).length).toBe(result.bytes);
  });

  it('rejects non-http URLs and non-image responses', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<html></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    })) as unknown as typeof fetch;
    const { downloadWebImage } = await import('./web-image');

    await expect(downloadWebImage('ws-1', 'file:///etc/passwd')).rejects.toThrow('http or https');
    await expect(downloadWebImage('ws-1', 'https://example.com/page')).rejects.toThrow('not a supported image');
  });

  it('stops reading a body without Content-Length at the size limit', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 64) controller.close();
        else controller.enqueue(chunk);
      },
    });
    globalThis.fetch = vi.fn(async () => new Response(body, {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })) as unknown as typeof fetch;
    const { downloadWebImage } = await import('./web-image');

    await expect(downloadWebImage('ws-1', 'https://example.com/huge.png')).rejects.toThrow('larger than 15 MB');
    expect(pulled).toBeLessThan(20);
  });
});
