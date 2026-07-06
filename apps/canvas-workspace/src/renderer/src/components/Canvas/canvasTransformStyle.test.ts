import { describe, expect, it } from 'vitest';
import {
  getCanvasTransformClassName,
  getCanvasTransformTransition,
  LOD_SCALE_THRESHOLD,
} from './canvasTransformStyle';

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

/**
 * Guards the deep-zoom-out level-of-detail gating: below LOD_SCALE_THRESHOLD
 * the `--lod` class swaps live webpage `<iframe>`s for static placeholders
 * (the dominant per-gesture Layerize cost when a canvas holds many web
 * nodes). All classes are driven by the frozen `settledScale`, so they
 * toggle once on settle rather than per wheel tick.
 */
describe('getCanvasTransformClassName', () => {
  it('is just the base class when at rest at 100% zoom', () => {
    expect(getCanvasTransformClassName(false, false, 1)).toBe('canvas-transform');
  });

  it('adds --moving while gesturing or animating, without scale classes at 100%', () => {
    expect(getCanvasTransformClassName(true, false, 1)).toBe('canvas-transform canvas-transform--moving');
    expect(getCanvasTransformClassName(false, true, 1)).toBe('canvas-transform canvas-transform--moving');
  });

  it('adds --small below 0.6 but not --lod until below the LOD threshold', () => {
    expect(getCanvasTransformClassName(false, false, 0.5)).toBe('canvas-transform canvas-transform--small');
  });

  it('adds both --small and --lod once below LOD_SCALE_THRESHOLD', () => {
    const cls = getCanvasTransformClassName(false, false, LOD_SCALE_THRESHOLD - 0.01);
    expect(cls).toContain('canvas-transform--small');
    expect(cls).toContain('canvas-transform--lod');
  });

  it('does not enter LOD exactly at the threshold (strict less-than)', () => {
    expect(getCanvasTransformClassName(false, false, LOD_SCALE_THRESHOLD)).not.toContain('--lod');
  });

  it('drives LOD off the settled scale, so a gesture keeps LOD stable', () => {
    // Whether or not the canvas is mid-gesture, the LOD class depends only
    // on the (frozen) settledScale — so it never flips per wheel tick.
    const moving = getCanvasTransformClassName(true, false, 0.3);
    const idle = getCanvasTransformClassName(false, false, 0.3);
    expect(moving).toContain('canvas-transform--lod');
    expect(idle).toContain('canvas-transform--lod');
  });
});
