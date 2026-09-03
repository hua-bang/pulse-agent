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

  it('caps page routes while preserving a usable page column', () => {
    expect(resolveDockMaxWidth(1200, true)).toBe(680);
    expect(resolveDockMaxWidth(1200, true, 680)).toBe(520);
    expect(resolveDockMaxWidth(1600, true)).toBe(1080);
    expect(resolveDockMaxWidth(2400, true)).toBe(1680);
  });

  it('never caps below the minimum width, however narrow the window', () => {
    expect(resolveDockMaxWidth(400, true)).toBe(DOCK_MIN_WIDTH);
    expect(clampDockWidth(DOCK_MIN_WIDTH, 400, true)).toBe(DOCK_MIN_WIDTH);
  });

  it('shrinks a canvas-sized width on a page route and restores it on the way back', () => {
    // The stored preference is what round-trips: the cap only shapes the
    // rendered width, so leaving and re-entering the canvas is lossless.
    const chosen = 1400;
    expect(clampDockWidth(chosen, 1600, true)).toBe(1080);
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

  it('leaves room for the close button, which sits outside this width', () => {
    // The returned width styles the tab BUTTON; the shell also carries a
    // close affordance, so an even split of the strip overflows.
    expect(resolveTabWidth(2, 480)).toBeLessThan(Math.floor((480 - 96) / 2));
  });

  it('shrinks tabs as the strip fills, instead of running off the edge', () => {
    const roomy = resolveTabWidth(2, 480);
    const crowded = resolveTabWidth(5, 480);
    expect(crowded).toBeLessThan(roomy);
    expect(crowded).toBeGreaterThanOrEqual(TAB_MIN_WIDTH);
  });

  it('stops shrinking at the floor and lets the strip scroll instead', () => {
    // Verified against a render: below this the icon and padding eat the row
    // and the title truncates to a character or two, which is not a label.
    expect(resolveTabWidth(8, 480)).toBe(TAB_MIN_WIDTH);
    expect(resolveTabWidth(400, 480)).toBe(TAB_MIN_WIDTH);
  });

  it('gives wider docks wider tabs for the same tab count', () => {
    expect(resolveTabWidth(3, 900)).toBeGreaterThan(resolveTabWidth(3, 480));
  });

  it('is defined for an empty strip', () => {
    expect(resolveTabWidth(0, 480)).toBe(TAB_MAX_WIDTH);
  });
});
