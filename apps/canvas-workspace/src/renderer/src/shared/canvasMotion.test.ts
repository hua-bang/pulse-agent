import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCanvasMotion,
  isHeavyZoomOut,
  setCanvasMotion,
  subscribeCanvasMotion,
} from './canvasMotion';

afterEach(() => setCanvasMotion('idle', false));

describe('canvasMotion signal', () => {
  it('notifies subscribers on a state change and reflects it in getCanvasMotion', () => {
    const seen: string[] = [];
    const unsub = subscribeCanvasMotion((s) => seen.push(`${s.mode}:${s.heavy}`));
    setCanvasMotion('zoom-out', true);
    expect(getCanvasMotion()).toEqual({ mode: 'zoom-out', heavy: true });
    expect(seen).toEqual(['zoom-out:true']);
    unsub();
    setCanvasMotion('idle', false);
    expect(seen).toEqual(['zoom-out:true']); // no notify after unsubscribe
  });

  it('dedupes identical state (no redundant notify per wheel tick)', () => {
    const listener = vi.fn();
    const unsub = subscribeCanvasMotion(listener);
    setCanvasMotion('zoom-out', true);
    setCanvasMotion('zoom-out', true);
    setCanvasMotion('zoom-out', true);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('isHeavyZoomOut is true only for a heavy zoom-out', () => {
    setCanvasMotion('zoom-out', true);
    expect(isHeavyZoomOut()).toBe(true);
    setCanvasMotion('zoom-out', false);
    expect(isHeavyZoomOut()).toBe(false); // not heavy
    setCanvasMotion('zoom-in', true);
    expect(isHeavyZoomOut()).toBe(false); // wrong direction
    setCanvasMotion('pan', true);
    expect(isHeavyZoomOut()).toBe(false);
  });

  it('a throwing subscriber does not wedge the gesture or other subscribers', () => {
    const good = vi.fn();
    const unsubBad = subscribeCanvasMotion(() => { throw new Error('boom'); });
    const unsubGood = subscribeCanvasMotion(good);
    expect(() => setCanvasMotion('zoom-out', true)).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    unsubBad();
    unsubGood();
  });
});
