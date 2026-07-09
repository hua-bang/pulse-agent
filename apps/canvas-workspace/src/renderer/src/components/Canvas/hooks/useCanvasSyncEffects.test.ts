import { describe, expect, it } from 'vitest';
import { shouldPersistViewportTransform } from './useCanvasSyncEffects';

describe('shouldPersistViewportTransform', () => {
  it('does not persist before the canvas has loaded', () => {
    expect(shouldPersistViewportTransform(false, false)).toBe(false);
  });

  it('defers viewport persistence while pan or zoom is moving', () => {
    expect(shouldPersistViewportTransform(true, true)).toBe(false);
  });

  it('persists the settled viewport once the gesture is idle', () => {
    expect(shouldPersistViewportTransform(true, false)).toBe(true);
  });
});
