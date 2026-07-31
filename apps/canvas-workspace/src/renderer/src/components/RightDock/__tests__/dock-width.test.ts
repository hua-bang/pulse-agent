import { describe, expect, it } from 'vitest';
import { clampDockWidth, DOCK_MIN_WIDTH, resolveDockMaxWidth } from '../dock-width';

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
