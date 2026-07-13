import { describe, expect, it } from 'vitest';
import {
  captureBoundedSnapshot,
  toBoundedSnapshotDataUrl,
  type CapturableImage,
} from '../snapshot';

const image = (width: number, empty = false): CapturableImage => ({
  isEmpty: () => empty,
  getSize: () => ({ width, height: Math.round(width * 0.75) }),
  resize: ({ width: w }) => image(w),
  toDataURL: () => `data:image/png;w=${width}`,
});

describe('toBoundedSnapshotDataUrl', () => {
  it('passes narrow images through and resizes wide ones to the display bound', () => {
    expect(toBoundedSnapshotDataUrl(image(400))).toBe('data:image/png;w=400');
    expect(toBoundedSnapshotDataUrl(image(1600))).toBe('data:image/png;w=800');
  });

  it('drops empty captures so the renderer falls back to the card placeholder', () => {
    expect(toBoundedSnapshotDataUrl(image(400, true))).toBeUndefined();
  });
});

describe('captureBoundedSnapshot', () => {
  it('encodes a capture that settles in time', async () => {
    const wc = { capturePage: async () => image(400) };
    await expect(captureBoundedSnapshot(wc, 1_000)).resolves.toBe('data:image/png;w=400');
  });

  it('resolves undefined when capturePage never settles — the CI-observed hang on hidden guests', async () => {
    const wc = { capturePage: () => new Promise<CapturableImage>(() => {}) };
    await expect(captureBoundedSnapshot(wc, 50)).resolves.toBeUndefined();
  });

  it('resolves undefined when capturePage rejects', async () => {
    const wc = { capturePage: () => Promise.reject(new Error('boom')) };
    await expect(captureBoundedSnapshot(wc, 1_000)).resolves.toBeUndefined();
  });
});
