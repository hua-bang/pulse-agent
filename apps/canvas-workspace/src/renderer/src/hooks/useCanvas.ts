import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasTransform } from "../types";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const ZOOM_SENSITIVITY = 0.005;
/** Idle delay after the last wheel/pan event before we drop `will-change`
 *  off `.canvas-transform`. Short enough to feel instant, long enough to
 *  cover the gap between two wheel events from a trackpad. */
const MOVING_IDLE_MS = 180;
/** Wheel deltas at or above this magnitude are discrete mouse-wheel
 *  notches (Chromium reports ~100-120/notch; the ±50 clamp saturates
 *  them to a ×1.25 step). Smaller deltas are a trackpad pinch stream.
 *  Both go through the zoom tween — the split only selects the tween
 *  RATE below. */
const DISCRETE_ZOOM_DELTA = 40;
/** Exponential approach rates (per second) for the zoom tween: each
 *  frame the transform covers `1 - exp(-RATE·dt)` of its remaining
 *  distance to the target.
 *
 *  NOTCH (~25%/frame at 60fps, ~90% of a step in ~130ms): a wheel notch
 *  used to apply its whole ×1.25 step in a single frame — a staircase no
 *  amount of frame-rate work can make feel smooth. Gliding to the
 *  compounded target is what Heptabase/Figma-style zoom does.
 *
 *  PINCH (~42%/frame at 60fps, ~30ms behind the fingers): macOS delivers
 *  pinch (ctrl+wheel) events at a rate independent of — often below —
 *  the display refresh, so applying each event directly leaves the
 *  refresh frames BETWEEN events with zero motion (measured: a 30Hz
 *  pinch stream left 74% of frames stalled — the trackpad staircase/
 *  jitter). The tight tween interpolates those in-between frames while
 *  staying close enough to the fingers that the smoothing doesn't read
 *  as lag. */
const ZOOM_TWEEN_RATE_NOTCH = 18;
const ZOOM_TWEEN_RATE_PINCH = 34;
/** Tween convergence epsilons: snap-to-target once the remaining delta
 *  is imperceptible, so the rAF loop terminates and `moving` (which the
 *  tween keeps alive for will-change) can settle. */
const ZOOM_TWEEN_SCALE_EPSILON = 0.003;
const ZOOM_TWEEN_XY_EPSILON = 1;

const clampScale = (s: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

const safeNum = (n: number, fallback = 0) =>
  Number.isFinite(n) ? n : fallback;

export const useCanvas = (isHandTool = false) => {
  const [transform, setTransform] = useState<CanvasTransform>({
    x: 0,
    y: 0,
    scale: 1
  });

  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);

  // Tracks whether the canvas is currently being panned/zoomed. Drives
  // the conditional `will-change: transform` on `.canvas-transform` so
  // we only promote the big canvas subtree to its own compositor layer
  // while it's actually moving — otherwise the permanent layer consumes
  // enough tile memory to trigger Chromium's "tile memory limits
  // exceeded" warning once nested frames multiply the painted area.
  const [moving, setMoving] = useState(false);
  const movingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Latest transform, readable from identity-stable callbacks. Assigned
  // every render so `screenToCanvas` can stay referentially stable — its
  // old dependency on the `transform` state recreated it (and the large
  // downstream useCallback/useMemo/effect graph across the canvas hooks)
  // on EVERY wheel tick of a zoom gesture.
  const transformRef = useRef(transform);
  transformRef.current = transform;

  // Scale as of the last moment the canvas was at rest. While a pan/zoom
  // gesture is in flight this intentionally lags behind `transform.scale`:
  // it feeds the inherited `--canvas-scale` custom property and the
  // `canvas-transform--small` class in CanvasSurface. Updating those on
  // every wheel tick forced a style recalc of the whole canvas subtree
  // plus layout/repaint of every scale-compensated element (terminal
  // containers, frame headers, …), which invalidated the promoted
  // compositor layer's tiles each tick — the re-raster storm behind the
  // "tile memory limits exceeded" blank flashes and zoom jank on large
  // canvases. Freezing them for the duration of the gesture keeps the
  // zoom a pure compositor-side stretch of already-rastered tiles;
  // everything re-styles once when the gesture settles (MOVING_IDLE_MS).
  const settledScaleRef = useRef(transform.scale);
  if (!moving) settledScaleRef.current = transform.scale;
  const settledScale = settledScaleRef.current;

  const rafIdRef = useRef<number | null>(null);

  // ── Discrete-wheel zoom tween state ─────────────────────────────────
  // Where the wheel wants the transform to END UP. Discrete notches
  // compound onto this target (three quick notches = one glide toward
  // ×1.25³) while the visible transform eases toward it each frame
  // (stepZoomTween below). Kept in lock-step with every non-tween
  // mutation (pan shifts it, pinch and external setTransform overwrite
  // it) so a later notch always compounds from coherent state.
  const zoomTargetRef = useRef(transform);
  const zoomTweenRaf = useRef<number | null>(null);
  const zoomTweenLastTs = useRef(0);
  const zoomTweenRate = useRef(ZOOM_TWEEN_RATE_NOTCH);

  const stopZoomTween = useCallback(() => {
    if (zoomTweenRaf.current != null) {
      cancelAnimationFrame(zoomTweenRaf.current);
      zoomTweenRaf.current = null;
    }
  }, []);

  // Coalesces same-animation-frame transform updates into a single React
  // commit. Measured (isolated re-render harness, this session): a
  // CanvasSurface commit costs roughly 0.14ms + 0.0045ms per node — under
  // a 16ms frame budget for ONE commit even at hundreds of nodes, but a
  // wheel/pan gesture previously committed once per raw input event, and
  // any input source faster than ~60Hz (many trackpads/mice report well
  // above that) fires multiple events per animation frame — paying that
  // per-commit cost several times over for a frame the browser can only
  // ever paint once. `commitTransform` writes synchronously into
  // `transformRef` (so same-frame ticks still compound correctly against
  // each other and any other same-tick reader sees the latest value) and
  // schedules at most one rAF per frame to flush the final accumulated
  // value into React state.
  const commitTransform = useCallback((next: CanvasTransform) => {
    transformRef.current = next;
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      setTransform(transformRef.current);
    });
  }, []);

  // Wraps the raw setState so external one-shot callers (useCanvasFit's
  // fit/focus, workspace-load restore) can't be silently clobbered by a
  // gesture's pending coalesced rAF OR an in-flight zoom tween landing
  // right after them — cancel both and adopt the external value as the
  // new ground truth immediately.
  const setTransformSafe = useCallback(
    (value: CanvasTransform | ((prev: CanvasTransform) => CanvasTransform)) => {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      stopZoomTween();
      setTransform((prev) => {
        const next = typeof value === 'function'
          ? (value as (p: CanvasTransform) => CanvasTransform)(prev)
          : value;
        transformRef.current = next;
        zoomTargetRef.current = next;
        return next;
      });
    },
    [stopZoomTween]
  );

  useEffect(() => {
    return () => {
      if (rafIdRef.current != null) cancelAnimationFrame(rafIdRef.current);
    };
  }, []);

  const markMoving = useCallback(() => {
    setMoving(true);
    if (movingTimer.current) clearTimeout(movingTimer.current);
    movingTimer.current = setTimeout(() => {
      setMoving(false);
      movingTimer.current = null;
    }, MOVING_IDLE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (movingTimer.current) clearTimeout(movingTimer.current);
    };
  }, []);

  const stepZoomTween = useCallback(function step(ts: number) {
    zoomTweenRaf.current = null;
    const dtMs = zoomTweenLastTs.current ? ts - zoomTweenLastTs.current : 16;
    zoomTweenLastTs.current = ts;
    // Frame-rate independent easing; clamp dt so a background-tab stall
    // doesn't overshoot numerically.
    const alpha = 1 - Math.exp(-zoomTweenRate.current * Math.min(100, Math.max(1, dtMs)) / 1000);
    const cur = transformRef.current;
    const tgt = zoomTargetRef.current;
    const dx = tgt.x - cur.x;
    const dy = tgt.y - cur.y;
    const ds = tgt.scale - cur.scale;
    const done = Math.abs(ds) < ZOOM_TWEEN_SCALE_EPSILON
      && Math.abs(dx) < ZOOM_TWEEN_XY_EPSILON
      && Math.abs(dy) < ZOOM_TWEEN_XY_EPSILON;
    // Lerping x/y/scale with the SAME alpha exactly preserves the zoom
    // anchor: the cursor's canvas point maps to the same screen point in
    // both `cur` and `tgt` (that's how the target was built), and screen
    // position is affine in (x, y, scale), so every blend of the two
    // keeps it fixed. Interpolating scale in log-space instead would
    // break that invariant and make the anchor drift mid-glide.
    const next = done ? tgt : {
      x: safeNum(cur.x + dx * alpha),
      y: safeNum(cur.y + dy * alpha),
      scale: cur.scale + ds * alpha,
    };
    transformRef.current = next;
    setTransform(next);
    // Keep `moving` (→ will-change layer promotion) alive for the whole
    // glide, not just until 180ms after the last wheel event — demoting
    // the layer mid-glide would re-rasterize while still in motion.
    markMoving();
    if (!done) zoomTweenRaf.current = requestAnimationFrame(step);
  }, [markMoving]);

  const startZoomTween = useCallback(() => {
    if (zoomTweenRaf.current != null) return;
    zoomTweenLastTs.current = 0;
    zoomTweenRaf.current = requestAnimationFrame(stepZoomTween);
  }, [stepZoomTween]);

  useEffect(() => {
    return () => {
      if (zoomTweenRaf.current != null) cancelAnimationFrame(zoomTweenRaf.current);
    };
  }, []);

  // NOTE: React (17+) registers root `wheel` listeners as passive, so this
  // synthetic handler cannot preventDefault — Chromium would log an
  // intervention error on every pinch and the default ctrl+wheel page zoom
  // would still fire. The Canvas component attaches a native
  // `{ passive: false }` wheel listener that does the preventDefault.
  const handleWheel = useCallback((e: React.WheelEvent) => {
    markMoving();
    if (e.ctrlKey || e.metaKey) {
      e.stopPropagation();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const clampedDelta = Math.max(-50, Math.min(50, e.deltaY));
      // Every zoom event compounds onto the tween TARGET (rapid notches
      // stack into one longer glide; a pinch stream's net zoom is the
      // exact product of its event factors) and the visible transform
      // glides toward it. The magnitude split only picks how tightly the
      // glide tracks: big discrete notches take the longer NOTCH glide,
      // pinch deltas the ~30ms PINCH smoothing that fills the refresh
      // frames between input events.
      const prev = zoomTargetRef.current;
      const factor = 1 - clampedDelta * ZOOM_SENSITIVITY;
      const newScale = clampScale(prev.scale * factor);
      const ratio = newScale / prev.scale;
      zoomTargetRef.current = {
        x: safeNum(mx - (mx - prev.x) * ratio),
        y: safeNum(my - (my - prev.y) * ratio),
        scale: newScale
      };
      zoomTweenRate.current = Math.abs(e.deltaY) >= DISCRETE_ZOOM_DELTA
        ? ZOOM_TWEEN_RATE_NOTCH
        : ZOOM_TWEEN_RATE_PINCH;
      startZoomTween();
    } else {
      const prev = transformRef.current;
      const dx = e.deltaX;
      const dy = e.deltaY;
      // Shift any in-flight zoom target by the same pan delta so panning
      // mid-glide translates the whole motion instead of yanking the
      // glide back toward a stale destination.
      const tgt = zoomTargetRef.current;
      zoomTargetRef.current = {
        ...tgt,
        x: safeNum(tgt.x - dx),
        y: safeNum(tgt.y - dy)
      };
      commitTransform({
        ...prev,
        x: safeNum(prev.x - dx),
        y: safeNum(prev.y - dy)
      });
    }
  }, [markMoving, commitTransform, startZoomTween]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (
        e.button === 1 ||
        (e.button === 0 && e.altKey) ||
        (e.button === 0 && isHandTool)
      ) {
        isPanning.current = true;
        setPanning(true);
        lastMouse.current = { x: e.clientX, y: e.clientY };
        markMoving();
        e.preventDefault();
      }
    },
    [isHandTool, markMoving]
  );

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning.current) return;
    const dx = e.clientX - lastMouse.current.x;
    const dy = e.clientY - lastMouse.current.y;
    lastMouse.current = { x: e.clientX, y: e.clientY };
    markMoving();
    const prev = transformRef.current;
    const tgt = zoomTargetRef.current;
    zoomTargetRef.current = {
      ...tgt,
      x: safeNum(tgt.x + dx),
      y: safeNum(tgt.y + dy)
    };
    commitTransform({
      ...prev,
      x: safeNum(prev.x + dx),
      y: safeNum(prev.y + dy)
    });
  }, [markMoving, commitTransform]);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
    setPanning(false);
  }, []);

  // Identity-stable: reads the live transform from a ref. Every consumer
  // calls this inside event handlers (never at render time), so reading
  // the latest value at call time is equivalent — without tearing down
  // subscriptions/handlers that list it as a dependency on each tick.
  const screenToCanvas = useCallback(
    (screenX: number, screenY: number, container: HTMLElement) => {
      const rect = container.getBoundingClientRect();
      const { x, y, scale } = transformRef.current;
      return {
        x: (screenX - rect.left - x) / scale,
        y: (screenY - rect.top - y) / scale
      };
    },
    []
  );

  const resetTransform = useCallback(() => {
    setTransformSafe({ x: 0, y: 0, scale: 1 });
  }, [setTransformSafe]);

  return {
    transform,
    setTransform: setTransformSafe,
    settledScale,
    moving,
    panning,
    handleWheel,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    screenToCanvas,
    resetTransform
  };
};
