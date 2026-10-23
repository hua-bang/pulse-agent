import { describe, expect, it } from 'vitest';
import { pickFaviconTint } from './useFaviconTint';

const pixels = (...rgba: number[][]): Uint8ClampedArray => new Uint8ClampedArray(rgba.flat());

describe('pickFaviconTint', () => {
  it('averages the colored pixels and skips white, black, gray, and transparent ones', () => {
    expect(pickFaviconTint(pixels(
      [51, 112, 255, 255],
      [255, 255, 255, 255],
      [0, 0, 0, 255],
      [128, 128, 128, 255],
      [255, 0, 0, 0],
    ))).toBe('rgb(51 112 255)');
  });

  it('returns null for a monochrome icon', () => {
    expect(pickFaviconTint(pixels([20, 20, 20, 255], [250, 250, 250, 255]))).toBeNull();
  });
});
