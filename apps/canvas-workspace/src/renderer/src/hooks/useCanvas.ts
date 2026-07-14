import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { CanvasTransform } from "../types";

const MIN_SCALE = 0.1;
const MAX_SCALE = 4;
const ZOOM_SENSITIVITY = 0.005;
/** Idle delay after the last wheel/pan event before gesture-only rendering
 *  settles. Short enough to feel instant, long enough to cover the gap
 *  between two wheel events from a trackpad. */
const MOVING_IDLE_MS = 180;

const clampScale = (s: number) =>
  Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

const safeNum = (n: number, fallback = 0) =>
  Number.isFinite(n) ? n : fallback;

/**
 * Below this scale the canvas is an overview: embeds are unreadable, yet each
 * live inline iframe still pays raster + a compositor layer, and once the
 * zoomed-out viewport contains them every animated embed's rAF resumes
 * (measured 40%/55% frames >20ms on a 40-iframe canvas —
 * docs/performance-verification-large-canvas.md). `.canvas-transform--overview`
 * drives the CSS that swaps live iframes for placeholders
 * (IframeNodeBody/index.css, DynamicAppNodeBody/index.css). Deliberately
 * driven by settledScale (CanvasSurface's getCanvasTransformClassName), NOT
 * the live mid-gesture scale: an experiment that flipped the class from
 * applyTransformStyle on threshold-crossing moved the 40-iframe display
 * swap's layout/raster spike INTO the gesture window and measured worse
 * (zoom 16% → 20.6% frames >20ms) than paying it once at settle.
 */
export const OVERVIEW_SCALE_THRESHOLD = 0.35;

export const canvasTransformToCss = (transform: CanvasTransform): string =>
  `translate(${safeNum(transform.x)}px, ${safeNum(transform.y)}px) scale(${safeNum(transform.scale, 1)})`;

export const useCanvas = (
  isHandTool = false,
  transformElementRef?: RefObject<HTMLElement>,
) => {
  const [transform, setTransform] = useState<CanvasTransform>({
    x: 0,
    y: 0,
    scale: 1
  });

  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);

  // Tracks whether the canvas is currently being panned/zoomed. Gesture-only
  // rendering hides expensive chrome and freezes scale-dependent styles.
  // Do not use it to add `will-change: transform` to the root surface: the
  // first-event layer promotion can synchronously allocate/raster the entire
  // painted canvas and stall large workspaces before the gesture even starts.
  const [moving, setMoving] = useState(false);
  const movingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movingRef = useRef(false);

  // Latest transform, readable from identity-stable callbacks. At rest it
  // mirrors React state; during a gesture it becomes the live source of
  // truth so `screenToCanvas` and follow-up wheel ticks see the compositor
  // transform without requiring a React commit per frame.
  const transformRef = useRef(transform);
  if (!movingRef.current) {
    transformRef.current = transform;
  }

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
  const applyTransformStyle = useCallback(
    (next: CanvasTransform) => {
      const el = transformElementRef?.current;
      if (el) {
        el.style.transform = canvasTransformToCss(next);
        return true;
      }
      return false;
    },
    [transformElementRef],
  );

  // Coalesces same-animation-frame transform updates into one compositor
  // write. During a wheel/pan gesture the hot path intentionally bypasses
  // React state: `transformRef` is the live source of truth, rAF writes the
  // accumulated value straight to `.canvas-transform`, and React receives
  // the final transform when the gesture settles. This keeps pan/zoom close
  // to a retained scene-graph operation: one root transform moves, while
  // nodes, edges, overlays, and persistence stay parked.
  const commitTransform = useCallback((next: CanvasTransform) => {
    transformRef.current = next;
    if (rafIdRef.current != null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      if (!applyTransformStyle(transformRef.current)) {
        setTransform(transformRef.current);
      }
    });
  }, [applyTransformStyle]);

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
      if (movingTimer.current) {
        clearTimeout(movingTimer.current);
        movingTimer.current = null;
      }
      movingRef.current = false;
      setMoving(false);
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
    if (!movingRef.current) {
      movingRef.current = true;
      setMoving(true);
    }
    if (movingTimer.current) clearTimeout(movingTimer.current);
    movingTimer.current = setTimeout(() => {
      const next = transformRef.current;
      applyTransformStyle(next);
      setTransform(next);
      movingRef.current = false;
      setMoving(false);
      movingTimer.current = null;
    }, MOVING_IDLE_MS);
  }, [applyTransformStyle]);

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

  const renderTransform = moving ? transformRef.current : transform;

  return {
    transform: renderTransform,
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
