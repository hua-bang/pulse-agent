import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasNode } from "../types";

const DEFAULT_MIN_WIDTH = 200;
const DEFAULT_MIN_HEIGHT = 120;

export type ResizeEdge =
  | "right"
  | "bottom"
  | "bottom-right"
  | "left"
  | "top"
  | "top-left"
  | "top-right"
  | "bottom-left";

const hasRightEdge = (edge: ResizeEdge): boolean =>
  edge === "right" || edge === "top-right" || edge === "bottom-right";
const hasLeftEdge = (edge: ResizeEdge): boolean =>
  edge === "left" || edge === "top-left" || edge === "bottom-left";
const hasBottomEdge = (edge: ResizeEdge): boolean =>
  edge === "bottom" || edge === "bottom-left" || edge === "bottom-right";
const hasTopEdge = (edge: ResizeEdge): boolean =>
  edge === "top" || edge === "top-left" || edge === "top-right";

export interface NodeResizePreview {
  id: string;
  width: number;
  height: number;
  edge: ResizeEdge;
}

export const useNodeResize = (
  resizeNode: (id: string, width: number, height: number, x?: number, y?: number) => void,
  scale: number,
  nodes: CanvasNode[]
) => {
  // Latest nodes snapshot, read at gesture start to capture the node's
  // pre-resize origin (x/y). Kept in a ref so the start/move callbacks stay
  // stable and don't re-render the memoized node views on every nodes change.
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  const resizing = useRef<{
    id: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    startNodeX: number;
    startNodeY: number;
    minW: number;
    minH: number;
    edge: ResizeEdge;
  } | null>(null);
  const lastMoveEvent = useRef<React.MouseEvent | MouseEvent | null>(null);
  const moveFrame = useRef<number | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [resizePreview, setResizePreview] = useState<NodeResizePreview | null>(null);

  const onResizeStart = useCallback(
    (
      e: React.MouseEvent,
      nodeId: string,
      width: number,
      height: number,
      edge: ResizeEdge,
      minWidth?: number,
      minHeight?: number
    ) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      const node = nodesRef.current.find((n) => n.id === nodeId);
      resizing.current = {
        id: nodeId,
        startX: e.clientX,
        startY: e.clientY,
        startW: width,
        startH: height,
        startNodeX: node?.x ?? 0,
        startNodeY: node?.y ?? 0,
        minW: minWidth ?? DEFAULT_MIN_WIDTH,
        minH: minHeight ?? DEFAULT_MIN_HEIGHT,
        edge
      };
      setResizingId(nodeId);
      setResizePreview({
        id: nodeId,
        width: Math.round(width),
        height: Math.round(height),
        edge,
      });
    },
    []
  );

  const flushResizeMove = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      if (!resizing.current) return;
      const r = resizing.current;
      const dx = (e.clientX - r.startX) / scale;
      const dy = (e.clientY - r.startY) / scale;

      // The edges opposite the dragged ones stay anchored.
      const rightEdge = r.startNodeX + r.startW;
      const bottomEdge = r.startNodeY + r.startH;

      let newW = r.startW;
      let newH = r.startH;
      let newX = r.startNodeX;
      let newY = r.startNodeY;

      if (hasRightEdge(r.edge)) {
        // Left edge anchored: only width grows, origin unchanged.
        newW = Math.max(r.minW, Math.round(r.startW + dx));
      }
      if (hasLeftEdge(r.edge)) {
        // Right edge anchored: round the moving (left) edge and derive width
        // from it so the anchored edge never drifts by a rounding pixel. The
        // clamp keeps width >= minW (left edge can't cross right - minW).
        newX = Math.round(Math.min(r.startNodeX + dx, rightEdge - r.minW));
        newW = rightEdge - newX;
      }
      if (hasBottomEdge(r.edge)) {
        // Top edge anchored: only height grows, origin unchanged.
        newH = Math.max(r.minH, Math.round(r.startH + dy));
      }
      if (hasTopEdge(r.edge)) {
        // Bottom edge anchored: round the moving (top) edge, derive height.
        newY = Math.round(Math.min(r.startNodeY + dy, bottomEdge - r.minH));
        newH = bottomEdge - newY;
      }

      const width = newW;
      const height = newH;
      const x = newX;
      const y = newY;
      setResizePreview((prev) => {
        if (
          prev &&
          prev.id === r.id &&
          prev.width === width &&
          prev.height === height &&
          prev.edge === r.edge
        ) {
          return prev;
        }
        return { id: r.id, width, height, edge: r.edge };
      });
      resizeNode(r.id, width, height, x, y);
    },
    [resizeNode, scale]
  );

  const onResizeMove = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      lastMoveEvent.current = e;
      if (moveFrame.current !== null) return;
      moveFrame.current = requestAnimationFrame(() => {
        moveFrame.current = null;
        const nextEvent = lastMoveEvent.current;
        if (nextEvent) flushResizeMove(nextEvent);
      });
    },
    [flushResizeMove]
  );

  const onResizeEnd = useCallback(() => {
    if (moveFrame.current !== null) {
      cancelAnimationFrame(moveFrame.current);
      moveFrame.current = null;
    }
    const nextEvent = lastMoveEvent.current;
    if (nextEvent) {
      flushResizeMove(nextEvent);
      lastMoveEvent.current = null;
    }
    resizing.current = null;
    setResizingId(null);
    setResizePreview(null);
  }, [flushResizeMove]);

  /** Abort the gesture (Escape): restore the node's pre-drag dimensions and
   *  origin, then drop all resize state. Skips the restore when no resize tick
   *  was ever applied so a press-and-Escape doesn't dirty the node. */
  const onResizeCancel = useCallback(() => {
    if (moveFrame.current !== null) {
      cancelAnimationFrame(moveFrame.current);
      moveFrame.current = null;
    }
    const moved = lastMoveEvent.current !== null;
    lastMoveEvent.current = null;
    const r = resizing.current;
    if (r && moved) {
      resizeNode(r.id, Math.round(r.startW), Math.round(r.startH), r.startNodeX, r.startNodeY);
    }
    resizing.current = null;
    setResizingId(null);
    setResizePreview(null);
  }, [resizeNode]);

  useEffect(() => {
    return () => {
      if (moveFrame.current !== null) {
        cancelAnimationFrame(moveFrame.current);
      }
    };
  }, []);

  return {
    resizingId,
    resizePreview,
    onResizeStart,
    onResizeMove,
    onResizeEnd,
    onResizeCancel,
  };
};
