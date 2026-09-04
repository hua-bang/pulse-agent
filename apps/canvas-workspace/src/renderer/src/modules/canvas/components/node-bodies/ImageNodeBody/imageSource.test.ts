import { describe, expect, it } from 'vitest';
import { selectImageSource } from './imageSource';

describe('selectImageSource', () => {
  it('uses the bounded preview on the canvas and the original in fullscreen', () => {
    expect(selectImageSource('/images/original.png', '/cache/preview.png', false))
      .toBe('/cache/preview.png');
    expect(selectImageSource('/images/original.png', '/cache/preview.png', true))
      .toBe('/images/original.png');
  });

  it('falls back to the original while no preview is available', () => {
    expect(selectImageSource('/images/original.png', null, false))
      .toBe('/images/original.png');
  });

  it('does not decode the original while a canvas preview request is pending', () => {
    expect(selectImageSource('/images/original.png', null, false, false)).toBe('');
    expect(selectImageSource('/images/original.png', null, true, false))
      .toBe('/images/original.png');
  });
});
