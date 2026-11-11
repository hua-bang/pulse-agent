import { describe, expect, it } from 'vitest';
import { lockDragAxis } from './useNodeDrag';

describe('lockDragAxis', () => {
  it('keeps the dominant axis and drops the other', () => {
    expect(lockDragAxis(40, -12)).toEqual({ dx: 40, dy: 0, axis: 'x' });
    expect(lockDragAxis(-3, 25)).toEqual({ dx: 0, dy: 25, axis: 'y' });
  });
});
