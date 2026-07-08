import { describe, expect, it } from 'vitest';
import { getCanvasTransformTransition } from './CanvasSurface';

/**
 * Guards two zoom/pan-gesture polish fixes on `.canvas-transform`'s CSS
 * transition:
 *  - starting a wheel/pan gesture must immediately cut a fit/focus
 *    animation's transition (else it rubber-bands, re-easing from
 *    wherever the interpolation sat on every subsequent tick);
 *  - a gesture settling (not animating, not moving) must glide
 *    `--canvas-scale` rather than snap it, so scale-compensated content
 *    (terminal glyphs, frame headers) eases into place instead of
 *    popping.
 */
describe('getCanvasTransformTransition', () => {
  it('applies the combined fit transition only while animating and not gesturing', () => {
    expect(getCanvasTransformTransition(true, false)).toBe(
      'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94), --canvas-scale 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    );
  });

  it('cuts the fit transition the instant a gesture starts, even mid fit-animation', () => {
    expect(getCanvasTransformTransition(true, true)).toBeUndefined();
  });

  it('applies no transition while gesturing outside a fit animation', () => {
    expect(getCanvasTransformTransition(false, true)).toBeUndefined();
  });

  it('glides --canvas-scale only once a gesture settles (idle, not animating)', () => {
    expect(getCanvasTransformTransition(false, false)).toBe('--canvas-scale 140ms ease-out');
  });
});
