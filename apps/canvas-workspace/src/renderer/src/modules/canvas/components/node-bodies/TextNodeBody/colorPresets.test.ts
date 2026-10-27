import { describe, expect, it } from 'vitest';
import { resolveTextNodeColor } from './colorPresets';

describe('resolveTextNodeColor', () => {
  it('lets the default ink follow the theme', () => {
    expect(resolveTextNodeColor('#1f2328')).toBeUndefined();
    expect(resolveTextNodeColor('#1F2328')).toBeUndefined();
    expect(resolveTextNodeColor(undefined)).toBeUndefined();
  });

  it('keeps a color the user picked', () => {
    expect(resolveTextNodeColor('#cf222e')).toBe('#cf222e');
  });
});
