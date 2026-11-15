import { describe, expect, it } from 'vitest';
import { EDGE_PAN_MAX_STEP_PX, edgePanStep } from './edgePan';

const viewport = { left: 0, top: 0, right: 800, bottom: 600 };

describe('edgePanStep', () => {
  it('does not pan away from the edges', () => {
    expect(edgePanStep({ x: 400, y: 300 }, viewport)).toEqual({ dx: 0, dy: 0 });
  });

  it('pans toward the pointer side, faster nearer the edge', () => {
    const near = edgePanStep({ x: 790, y: 300 }, viewport);
    const nearer = edgePanStep({ x: 799, y: 300 }, viewport);
    expect(near.dx).toBeLessThan(0);
    expect(nearer.dx).toBeLessThan(near.dx);
    expect(edgePanStep({ x: 400, y: 5 }, viewport).dy).toBeGreaterThan(0);
  });

  it('keeps the maximum step past the edge', () => {
    expect(edgePanStep({ x: -200, y: 900 }, viewport)).toEqual({
      dx: EDGE_PAN_MAX_STEP_PX,
      dy: -EDGE_PAN_MAX_STEP_PX,
    });
  });
});
