// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvas } from './useCanvas';

/**
 * Guards the zoom-gesture rendering contract (canvas zoom jank / "tile
 * memory limits exceeded" blank flashes):
 *  - `settledScale` must FREEZE while a wheel gesture is in flight and
 *    catch up only after the moving-idle timeout. It feeds the inherited
 *    `--canvas-scale` custom property; updating that per wheel tick
 *    restyles/repaints the whole canvas subtree mid-gesture and
 *    invalidates the promoted compositor layer's tiles.
 *  - `screenToCanvas` must stay identity-stable across transform
 *    changes (it used to recreate the downstream hook/effect graph on
 *    every tick) while still reading the LIVE transform when called.
 */

let hook: ReturnType<typeof useCanvas>;

const Probe = () => {
  hook = useCanvas();
  return null;
};

describe('useCanvas zoom gesture', () => {
  let root: Root;
  let host: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    flushSync(() => root.render(<Probe />));
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const wheelZoom = (deltaY: number) => {
    flushSync(() => {
      hook.handleWheel({
        ctrlKey: true,
        metaKey: false,
        deltaY,
        deltaX: 0,
        clientX: 100,
        clientY: 80,
        currentTarget: host,
        stopPropagation: () => undefined,
      } as unknown as React.WheelEvent);
    });
  };

  const settleGesture = () => {
    // MOVING_IDLE_MS is 180; anything past it settles the gesture.
    flushSync(() => {
      vi.advanceTimersByTime(250);
    });
  };

  it('freezes settledScale during the gesture and commits it on settle', () => {
    expect(hook.settledScale).toBe(1);

    wheelZoom(-50);
    const midScale = hook.transform.scale;
    expect(midScale).toBeGreaterThan(1);
    expect(hook.moving).toBe(true);
    // Live scale moved, but the style-recalc-driving scale must not.
    expect(hook.settledScale).toBe(1);

    wheelZoom(-50);
    expect(hook.transform.scale).toBeGreaterThan(midScale);
    expect(hook.settledScale).toBe(1);

    settleGesture();
    expect(hook.moving).toBe(false);
    expect(hook.settledScale).toBe(hook.transform.scale);
  });

  it('tracks programmatic transform changes immediately when at rest', () => {
    flushSync(() => {
      hook.setTransform({ x: 40, y: 20, scale: 2 });
    });
    expect(hook.moving).toBe(false);
    expect(hook.settledScale).toBe(2);
  });

  it('keeps screenToCanvas identity-stable while reading the live transform', () => {
    const before = hook.screenToCanvas;

    wheelZoom(-50);
    settleGesture();
    expect(hook.transform.scale).toBeGreaterThan(1);
    expect(hook.screenToCanvas).toBe(before);

    // Conversion must use the CURRENT transform, not the one captured
    // when the callback was created. happy-dom rects are all-zero, so
    // the expected inverse is (screen - t) / scale directly.
    const { x, y, scale } = hook.transform;
    const point = before(10, 6, host);
    expect(point.x).toBeCloseTo((10 - x) / scale);
    expect(point.y).toBeCloseTo((6 - y) / scale);
  });
});
