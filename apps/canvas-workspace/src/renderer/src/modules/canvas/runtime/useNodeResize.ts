import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasNode, TextNodeData } from "../../../types";

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
  x: number;
  y: number;
  width: number;
  height: number;
  edge: ResizeEdge;
}

export interface NodeResizeOrigin {
  id: string;
  startPointerX: number;
  startPointerY: number;
  startWidth: number;
  startHeight: number;
  startNodeX: number;
  startNodeY: number;
  minWidth: number;
  minHeight: number;
  edge: ResizeEdge;
  /** Keep the start aspect ratio unless Shift is held (images). Otherwise
   *  Shift turns the ratio lock on. */
  lockAspect?: boolean;
}

/**
 * Scales the start box by one factor. A corner follows the larger change; an
 * edge drives the other side. Opposite edges stay fixed, and an edge handle
 * keeps the perpendicular top or left edge fixed.
 */
const computeAspectGeometry = (
  origin: NodeResizeOrigin,
  freeWidth: number,
  freeHeight: number,
): NodeResizePreview => {
  const { edge, startWidth, startHeight } = origin;
  const horizontal = hasLeftEdge(edge) || hasRightEdge(edge);
  const vertical = hasTopEdge(edge) || hasBottomEdge(edge);
  const widthFactor = freeWidth / startWidth;
  const heightFactor = freeHeight / startHeight;
  const requested = horizontal && vertical
    ? Math.max(widthFactor, heightFactor)
    : horizontal ? widthFactor : heightFactor;
  const factor = Math.max(
    requested,
    origin.minWidth / startWidth,
    origin.minHeight / startHeight,
  );
  const width = Math.round(startWidth * factor);
  const height = Math.round(startHeight * factor);
  const x = hasLeftEdge(edge) ? origin.startNodeX + startWidth - width : origin.startNodeX;
  const y = hasTopEdge(edge) ? origin.startNodeY + startHeight - height : origin.startNodeY;
  return { id: origin.id, x, y, width, height, edge };
};

export const computeNodeResizeGeometry = (
  origin: NodeResizeOrigin,
  clientX: number,
  clientY: number,
  scale: number,
  shiftKey = false,
): NodeResizePreview => {
  const safeScale = Math.max(scale, 0.0001);
  const dx = (clientX - origin.startPointerX) / safeScale;
  const dy = (clientY - origin.startPointerY) / safeScale;
  const rightEdge = origin.startNodeX + origin.startWidth;
  const bottomEdge = origin.startNodeY + origin.startHeight;

  const keepAspect = Boolean(origin.lockAspect) !== shiftKey;
  if (keepAspect && origin.startWidth > 0 && origin.startHeight > 0) {
    const freeWidth = origin.startWidth
      + (hasRightEdge(origin.edge) ? dx : 0)
      - (hasLeftEdge(origin.edge) ? dx : 0);
    const freeHeight = origin.startHeight
      + (hasBottomEdge(origin.edge) ? dy : 0)
      - (hasTopEdge(origin.edge) ? dy : 0);
    return computeAspectGeometry(origin, freeWidth, freeHeight);
  }

  let width = origin.startWidth;
  let height = origin.startHeight;
  let x = origin.startNodeX;
  let y = origin.startNodeY;

  if (hasRightEdge(origin.edge)) {
    width = Math.max(origin.minWidth, Math.round(origin.startWidth + dx));
  }
  if (hasLeftEdge(origin.edge)) {
    x = Math.round(Math.min(origin.startNodeX + dx, rightEdge - origin.minWidth));
    width = rightEdge - x;
  }
  if (hasBottomEdge(origin.edge)) {
    height = Math.max(origin.minHeight, Math.round(origin.startHeight + dy));
  }
  if (hasTopEdge(origin.edge)) {
    y = Math.round(Math.min(origin.startNodeY + dy, bottomEdge - origin.minHeight));
    height = bottomEdge - y;
  }

  return { id: origin.id, x, y, width, height, edge: origin.edge };
};

export const applyNodeResizePreview = (
  node: CanvasNode,
  preview: NodeResizePreview | null | undefined,
): CanvasNode => {
  if (preview?.id !== node.id) return node;
  const data = node.type === 'text'
    ? { ...(node.data as TextNodeData), autoSize: false }
    : node.data;
  return {
    ...node,
    x: preview.x,
    y: preview.y,
    width: preview.width,
    height: preview.height,
    data,
  };
};

export const applyResizePreviewToNodes = (
  nodes: CanvasNode[],
  preview: NodeResizePreview | null | undefined,
): CanvasNode[] => {
  if (!preview) return nodes;
  const index = nodes.findIndex((node) => node.id === preview.id);
  if (index < 0) return nodes;
  const projected = [...nodes];
  projected[index] = applyNodeResizePreview(nodes[index], preview);
  return projected;
};

const resizeGeometryChanged = (origin: NodeResizeOrigin, next: NodeResizePreview): boolean => (
  next.x !== origin.startNodeX ||
  next.y !== origin.startNodeY ||
  next.width !== origin.startWidth ||
  next.height !== origin.startHeight
);

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

  const resizing = useRef<NodeResizeOrigin | null>(null);
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
        startPointerX: e.clientX,
        startPointerY: e.clientY,
        startWidth: width,
        startHeight: height,
        startNodeX: node?.x ?? 0,
        startNodeY: node?.y ?? 0,
        minWidth: minWidth ?? DEFAULT_MIN_WIDTH,
        minHeight: minHeight ?? DEFAULT_MIN_HEIGHT,
        edge,
        lockAspect: node?.type === 'image',
      };
      lastMoveEvent.current = null;
      setResizingId(nodeId);
      setResizePreview({
        id: nodeId,
        x: node?.x ?? 0,
        y: node?.y ?? 0,
        width: Math.round(width),
        height: Math.round(height),
        edge,
      });
    },
    []
  );

  const flushResizeMove = useCallback(
    (e: React.MouseEvent | MouseEvent, commit: boolean) => {
      if (!resizing.current) return false;
      const r = resizing.current;
      const next = computeNodeResizeGeometry(r, e.clientX, e.clientY, scale, e.shiftKey);
      setResizePreview((prev) => {
        if (
          prev &&
          prev.id === next.id &&
          prev.x === next.x &&
          prev.y === next.y &&
          prev.width === next.width &&
          prev.height === next.height &&
          prev.edge === next.edge
        ) {
          return prev;
        }
        return next;
      });
      const changed = resizeGeometryChanged(r, next);
      if (commit && changed) resizeNode(r.id, next.width, next.height, next.x, next.y);
      return changed;
    },
    [resizeNode, scale]
  );

  const onResizeMove = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      const r = resizing.current;
      if (!r) return false;
      lastMoveEvent.current = e;
      if (moveFrame.current !== null) {
        return resizeGeometryChanged(r, computeNodeResizeGeometry(r, e.clientX, e.clientY, scale, e.shiftKey));
      }
      moveFrame.current = requestAnimationFrame(() => {
        moveFrame.current = null;
        const nextEvent = lastMoveEvent.current;
        if (nextEvent) flushResizeMove(nextEvent, false);
      });
      return resizeGeometryChanged(r, computeNodeResizeGeometry(r, e.clientX, e.clientY, scale, e.shiftKey));
    },
    [flushResizeMove, scale]
  );

  const onResizeEnd = useCallback(() => {
    if (moveFrame.current !== null) {
      cancelAnimationFrame(moveFrame.current);
      moveFrame.current = null;
    }
    const nextEvent = lastMoveEvent.current;
    let committed = false;
    if (nextEvent) {
      committed = flushResizeMove(nextEvent, true);
      lastMoveEvent.current = null;
    }
    resizing.current = null;
    setResizingId(null);
    setResizePreview(null);
    return committed;
  }, [flushResizeMove]);

  /** Abort the gesture (Escape): drop ephemeral geometry without committing.
   *  The real nodes array stays untouched throughout the gesture. */
  const onResizeCancel = useCallback(() => {
    if (moveFrame.current !== null) {
      cancelAnimationFrame(moveFrame.current);
      moveFrame.current = null;
    }
    lastMoveEvent.current = null;
    resizing.current = null;
    setResizingId(null);
    setResizePreview(null);
  }, []);

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
