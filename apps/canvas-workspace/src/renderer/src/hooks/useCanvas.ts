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
      setTransform((prev) => {
        const factor = 1 - clampedDelta * ZOOM_SENSITIVITY;
        const newScale = clampScale(prev.scale * factor);
        const ratio = newScale / prev.scale;
        return {
          x: safeNum(mx - (mx - prev.x) * ratio),
          y: safeNum(my - (my - prev.y) * ratio),
          scale: newScale
        };
      });
    } else {
      const dx = e.deltaX;
      const dy = e.deltaY;
      setTransform((prev) => ({
        ...prev,
        x: safeNum(prev.x - dx),
        y: safeNum(prev.y - dy)
      }));
    }
  }, [markMoving]);

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
    setTransform((prev) => ({
      ...prev,
      x: safeNum(prev.x + dx),
      y: safeNum(prev.y + dy)
    }));
  }, [markMoving]);

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
    setTransform({ x: 0, y: 0, scale: 1 });
  }, []);

  return {
    transform,
    setTransform,
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
