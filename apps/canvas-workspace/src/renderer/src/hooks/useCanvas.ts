import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasTransform } from "../types";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const ZOOM_SENSITIVITY = 0.005;
/** Idle delay after the last wheel/pan event before we drop `will-change`
 *  off `.canvas-transform`. Short enough to feel instant, long enough to
 *  cover the gap between two wheel events from a trackpad. */
const MOVING_IDLE_MS = 180;

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
  // gesture's pending coalesced rAF landing right after them — cancel it
  // and adopt the external value as the new ground truth immediately.
  const setTransformSafe = useCallback(
    (value: CanvasTransform | ((prev: CanvasTransform) => CanvasTransform)) => {
      if (rafIdRef.current != null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      setTransform((prev) => {
        const next = typeof value === 'function'
          ? (value as (p: CanvasTransform) => CanvasTransform)(prev)
          : value;
        transformRef.current = next;
        return next;
      });
    },
    []
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
      const prev = transformRef.current;
      const factor = 1 - clampedDelta * ZOOM_SENSITIVITY;
      const newScale = clampScale(prev.scale * factor);
      const ratio = newScale / prev.scale;
      commitTransform({
        x: safeNum(mx - (mx - prev.x) * ratio),
        y: safeNum(my - (my - prev.y) * ratio),
        scale: newScale
      });
    } else {
      const prev = transformRef.current;
      const dx = e.deltaX;
      const dy = e.deltaY;
      commitTransform({
        ...prev,
        x: safeNum(prev.x - dx),
        y: safeNum(prev.y - dy)
      });
    }
  }, [markMoving, commitTransform]);

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
