// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getImagePreview } from '.';

const api = {
  getImagePreview: vi.fn(),
  storeImagePreview: vi.fn(),
};

const rendered = { png: new Uint8Array([1, 2, 3]), width: 960, height: 720, originalWidth: 4000, originalHeight: 3000 };
const posted: unknown[] = [];

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage(job: { id: number }) {
    posted.push(job);
    queueMicrotask(() => this.onmessage?.({ data: { id: job.id, rendered } } as MessageEvent));
  }
}

beforeEach(() => {
  posted.length = 0;
  api.getImagePreview.mockReset();
  api.storeImagePreview.mockReset();
  window.canvasWorkspace = { file: api } as never;
  vi.stubGlobal('Worker', FakeWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('getImagePreview', () => {
  it('returns a cached preview without rendering', async () => {
    const preview = { path: '/cache/a.png', generated: true, width: 960, height: 720, originalWidth: 4000, originalHeight: 3000 };
    api.getImagePreview.mockResolvedValue({ ok: true, preview });

    await expect(getImagePreview('/img/a.png')).resolves.toEqual({ ok: true, preview });
    expect(posted).toEqual([]);
  });

  it('renders a missing preview in the worker and stores it under the lookup key', async () => {
    const preview = { path: '/cache/b.png', generated: true, width: 960, height: 720, originalWidth: 4000, originalHeight: 3000 };
    api.getImagePreview.mockResolvedValue({ ok: true, request: { cacheKey: 'key-b', maxDimension: 1600 } });
    api.storeImagePreview.mockResolvedValue({ ok: true, preview });

    await expect(getImagePreview('/img/b.png', 1600)).resolves.toEqual({ ok: true, preview });
    expect(posted).toEqual([expect.objectContaining({ url: 'pulse-canvas://local/img/b.png', maxDimension: 1600 })]);
    expect(api.storeImagePreview).toHaveBeenCalledWith('/img/b.png', 'key-b', rendered);
  });

  it('shares one render between concurrent requests for the same image', async () => {
    const preview = { path: '/cache/d.png', generated: true, width: 960, height: 720, originalWidth: 4000, originalHeight: 3000 };
    api.getImagePreview.mockResolvedValue({ ok: true, request: { cacheKey: 'key-d', maxDimension: 960 } });
    api.storeImagePreview.mockResolvedValue({ ok: true, preview });

    const results = await Promise.all([getImagePreview('/img/d.png'), getImagePreview('/img/d.png')]);

    expect(results).toEqual([{ ok: true, preview }, { ok: true, preview }]);
    expect(posted).toHaveLength(1);
    expect(api.storeImagePreview).toHaveBeenCalledTimes(1);
  });

  it('keeps the original path when the preview cannot be stored', async () => {
    api.getImagePreview.mockResolvedValue({ ok: true, request: { cacheKey: 'key-c', maxDimension: 960 } });
    api.storeImagePreview.mockResolvedValue({ ok: false, error: 'Image changed' });

    const result = await getImagePreview('/img/c.png');

    expect(result).toMatchObject({ ok: true, preview: { path: '/img/c.png', generated: false } });
  });
});
