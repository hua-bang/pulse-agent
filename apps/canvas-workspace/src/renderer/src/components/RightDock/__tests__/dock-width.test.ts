import { describe, expect, it } from 'vitest';
import {
  clampDockWidth,
  DOCK_MIN_WIDTH,
  resolveDockMaxWidth,
  resolveTabWidth,
  TAB_MAX_WIDTH,
  TAB_MIN_WIDTH,
} from '../dock-width';

describe('dock width policy', () => {
  it('lets the canvas dock grow to nearly the whole viewport', () => {
    expect(resolveDockMaxWidth(1600, false)).toBe(1520);
  });

  it('caps page routes at 70% of the viewport', () => {
    expect(resolveDockMaxWidth(1600, true)).toBe(1120);
  });

  it('never caps below the minimum width, however narrow the window', () => {
    expect(resolveDockMaxWidth(400, true)).toBe(DOCK_MIN_WIDTH);
    expect(clampDockWidth(DOCK_MIN_WIDTH, 400, true)).toBe(DOCK_MIN_WIDTH);
  });

  it('shrinks a canvas-sized width on a page route and restores it on the way back', () => {
    // The stored preference is what round-trips: the cap only shapes the
    // rendered width, so leaving and re-entering the canvas is lossless.
    const chosen = 1400;
    expect(clampDockWidth(chosen, 1600, true)).toBe(1120);
    expect(clampDockWidth(chosen, 1600, false)).toBe(1400);
  });

  it('leaves a width that already fits the cap untouched', () => {
    expect(clampDockWidth(520, 1600, true)).toBe(520);
  });
});

describe('tab width policy', () => {
  it('keeps tabs roomy while the strip has space', () => {
    expect(resolveTabWidth(1, 480)).toBe(TAB_MAX_WIDTH);
    expect(resolveTabWidth(2, 640)).toBe(TAB_MAX_WIDTH);
  });

  it('shrinks tabs as the strip fills, instead of running off the edge', () => {
    const roomy = resolveTabWidth(2, 480);
    const crowded = resolveTabWidth(5, 480);
    expect(crowded).toBeLessThan(roomy);
    expect(crowded).toBeGreaterThanOrEqual(TAB_MIN_WIDTH);
  });

  it('stops shrinking at the floor and lets the strip scroll instead', () => {
    // Past this point a favicon plus two characters is not a label, so
    // shrinking further would trade one unusable state for another.
    expect(resolveTabWidth(40, 480)).toBe(TAB_MIN_WIDTH);
    expect(resolveTabWidth(400, 480)).toBe(TAB_MIN_WIDTH);
  });

  it('gives wider docks wider tabs for the same tab count', () => {
    expect(resolveTabWidth(6, 900)).toBeGreaterThan(resolveTabWidth(6, 480));
  });

  it('is defined for an empty strip', () => {
    expect(resolveTabWidth(0, 480)).toBe(TAB_MAX_WIDTH);
  });
});
