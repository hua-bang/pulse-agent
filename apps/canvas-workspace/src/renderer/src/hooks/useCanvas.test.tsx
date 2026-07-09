// @vitest-environment happy-dom
import { act } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCanvas } from './useCanvas';

/**
 * Guards the zoom-gesture rendering contract (canvas zoom jank / "tile
 * memory limits exceeded" blank flashes, and the wasted-commit cost of
 * committing a transform update per raw input event):
 *  - `settledScale` must FREEZE while a wheel gesture is in flight and
 *    catch up only after the moving-idle timeout. It feeds the inherited
 *    `--canvas-scale` custom property; updating that per wheel tick
 *    restyles/repaints the whole canvas subtree mid-gesture and
 *    invalidates the promoted compositor layer's tiles.
 *  - `screenToCanvas` must stay identity-stable across transform
 *    changes (it used to recreate the downstream hook/effect graph on
 *    every tick) while still reading the LIVE transform when called.
 *  - transform updates within a gesture must update the transform layer
 *    directly instead of committing React state once per display frame.
 *    React participates at gesture start/end only; the hot path remains a
 *    single compositor transform write while still compounding correctly
 *    and losing to an external one-shot setTransform (fit/focus/restore).
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let hook: ReturnType<typeof useCanvas>;
let transformLayer: HTMLElement;
let transformLayerRef: { current: HTMLElement | null };
let renderCount = 0;

const Probe = () => {
  renderCount += 1;
  hook = useCanvas(false, transformLayerRef);
  return null;
};

describe('useCanvas zoom gesture', () => {
  let root: Root;
  let host: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
    host = document.createElement('div');
    transformLayer = document.createElement('div');
    transformLayerRef = { current: transformLayer };
    renderCount = 0;
    host.appendChild(transformLayer);
    document.body.appendChild(host);
    root = createRoot(host);
    flushSync(() => root.render(<Probe />));
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });

  const wheelEvent = (deltaY: number) => ({
    ctrlKey: true,
    metaKey: false,
    deltaY,
    deltaX: 0,
    clientX: 100,
    clientY: 80,
    currentTarget: host,
    stopPropagation: () => undefined,
  } as unknown as React.WheelEvent);

  // One simulated wheel tick, with its coalesced rAF commit flushed —
  // matches a real browser painting between two spaced-apart wheel
  // events. React 18's scheduler processes the rAF-triggered setState via
  // its own (MessageChannel-based) work loop, which plain flushSync can't
  // force through — act() is what actually flushes it here.
  const wheelZoom = (deltaY: number) => {
    act(() => {
      hook.handleWheel(wheelEvent(deltaY));
      vi.advanceTimersByTime(20);
    });
  };

  const settleGesture = () => {
    // MOVING_IDLE_MS is 180; anything past it settles the gesture.
    act(() => {
      vi.advanceTimersByTime(250);
    });
  };

  const transformLayerScale = () =>
    Number(transformLayer.style.transform.match(/scale\(([^)]+)\)/)?.[1] ?? '1');

  it('freezes settledScale during the gesture and commits it on settle', () => {
    expect(hook.settledScale).toBe(1);

    wheelZoom(-50);
    const midScale = transformLayerScale();
    expect(midScale).toBeGreaterThan(1);
    expect(hook.moving).toBe(true);
    // Live scale moved, but the style-recalc-driving scale must not.
    expect(hook.settledScale).toBe(1);

    wheelZoom(-50);
    const liveScale = transformLayerScale();
    expect(liveScale).toBeGreaterThan(midScale);
    expect(hook.settledScale).toBe(1);

    settleGesture();
    expect(hook.moving).toBe(false);
    expect(hook.transform.scale).toBeCloseTo(liveScale);
    expect(hook.settledScale).toBe(hook.transform.scale);
  });

  it('tracks programmatic transform changes immediately when at rest', () => {
    act(() => {
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

  it('updates the transform layer without a React render for every wheel tick', async () => {
    const initialRenderCount = renderCount;
    // Three ticks with NO timer advance between them — simulates a
    // higher-than-display-refresh-rate input device firing several
    // events within one animation frame. transformRef must compound
    // each tick correctly even though React state does not commit yet.
    await act(async () => {
      hook.handleWheel(wheelEvent(-50));
      hook.handleWheel(wheelEvent(-50));
      hook.handleWheel(wheelEvent(-50));
      vi.advanceTimersByTime(20);
    });
    const afterThreeTicks = transformLayerScale();
    expect(renderCount).toBe(initialRenderCount + 1);

    // One further tick, its own frame — the running scale should continue
    // compounding from the coalesced value above, without another React
    // render while the gesture is already marked moving.
    wheelZoom(-50);
    expect(transformLayerScale()).toBeGreaterThan(afterThreeTicks);
    expect(renderCount).toBe(initialRenderCount + 1);
  });

  it('lets an external one-shot setTransform win over a pending gesture commit', async () => {
    // Note: this test logs a benign "update not wrapped in act()" warning
    // from React's scheduler settling a trailing microtask just past the
    // awaited act() call (a known quirk of fake timers + rAF + the
    // concurrent scheduler outside React Testing Library's fuller act()
    // environment) — the assertion below is what actually matters, and
    // it's exact: no clobbering occurred.
    await act(async () => {
      // Start a gesture tick but DON'T flush its rAF yet — it's still
      // pending when the external setTransform below fires (e.g. a
      // workspace-load restore or fit-to-view racing a residual gesture).
      hook.handleWheel(wheelEvent(-50));
      hook.setTransform({ x: 999, y: 999, scale: 3 });
      // If the gesture's rAF were still pending, letting it fire here
      // would clobber the external value with the stale gesture result.
      vi.advanceTimersByTime(20);
    });

    expect(hook.transform).toEqual({ x: 999, y: 999, scale: 3 });
  });
});
