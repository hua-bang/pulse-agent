import { describe, expect, it } from 'vitest';
import {
  getCanvasTransformClassName,
  getCanvasTransformTransition,
  OVERVIEW_SCALE_THRESHOLD,
} from './CanvasSurface';

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
 * Guards the scale-threshold classes that drive CSS-side semantic zoom:
 * `--small` (< 0.6) floats node-header actions; `--overview`
 * (< OVERVIEW_SCALE_THRESHOLD) swaps live inline iframes for placeholders
 * (IframeNodeBody/index.css). The thresholds gate live-embed cost at
 * overview zoom, so they must not drift silently.
 */
describe('getCanvasTransformClassName', () => {
  it('adds only the base class at normal scale while idle', () => {
    expect(getCanvasTransformClassName(false, false, 1)).toBe('canvas-transform');
  });

  it('marks gestures and fit animations as moving', () => {
    expect(getCanvasTransformClassName(true, false, 1)).toContain('canvas-transform--moving');
    expect(getCanvasTransformClassName(false, true, 1)).toContain('canvas-transform--moving');
  });

  it('adds --small below 0.6 without entering overview', () => {
    const cls = getCanvasTransformClassName(false, false, 0.5);
    expect(cls).toContain('canvas-transform--small');
    expect(cls).not.toContain('canvas-transform--overview');
  });

  it('enters overview below the threshold (and keeps --small)', () => {
    const cls = getCanvasTransformClassName(false, false, OVERVIEW_SCALE_THRESHOLD - 0.01);
    expect(cls).toContain('canvas-transform--small');
    expect(cls).toContain('canvas-transform--overview');
  });

  it('stays out of overview exactly at the threshold', () => {
    expect(getCanvasTransformClassName(false, false, OVERVIEW_SCALE_THRESHOLD)).not.toContain(
      'canvas-transform--overview',
    );
  });
});
