import { useCallback, useRef, useState } from "react";
import type { CanvasNode } from "../types";

/** Check if a node's center is inside a frame's bounding box */
const isInsideFrame = (node: CanvasNode, frame: CanvasNode): boolean => {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  return (
    cx >= frame.x &&
    cx <= frame.x + frame.width &&
    cy >= frame.y &&
    cy <= frame.y + frame.height
  );
};

export const useNodeDrag = (
  moveNode: (id: string, x: number, y: number) => void,
  moveNodes: (moves: Array<{ id: string; x: number; y: number }>) => void,
  scale: number,
  nodes: CanvasNode[]
) => {
  const dragging = useRef<{
    id: string;
    startX: number;
    startY: number;
    nodeX: number;
    nodeY: number;
    children: Array<{ id: string; nodeX: number; nodeY: number }>;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const onDragStart = useCallback(
    (e: React.MouseEvent, node: CanvasNode) => {
      if (e.button !== 0 || e.altKey) return;
      e.stopPropagation();

      // If dragging a frame, find contained child nodes
      let children: Array<{ id: string; nodeX: number; nodeY: number }> = [];
      if (node.type === "frame") {
        children = nodes
          .filter((n) => n.id !== node.id && n.type !== "frame" && isInsideFrame(n, node))
          .map((n) => ({ id: n.id, nodeX: n.x, nodeY: n.y }));
      }

      dragging.current = {
        id: node.id,
        startX: e.clientX,
        startY: e.clientY,
        nodeX: node.x,
        nodeY: node.y,
        children
      };
      setDraggingId(node.id);
    },
    [nodes]
  );

  const onDragMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging.current) return;
      const d = dragging.current;
      const dx = (e.clientX - d.startX) / scale;
      const dy = (e.clientY - d.startY) / scale;

      if (d.children.length > 0) {
        // Batch move frame + children
        const moves = [
          { id: d.id, x: d.nodeX + dx, y: d.nodeY + dy },
          ...d.children.map((c) => ({
            id: c.id,
            x: c.nodeX + dx,
            y: c.nodeY + dy
          }))
        ];
        moveNodes(moves);
      } else {
        moveNode(d.id, d.nodeX + dx, d.nodeY + dy);
      }
    },
    [moveNode, moveNodes, scale]
  );

  const onDragEnd = useCallback(() => {
    dragging.current = null;
    setDraggingId(null);
  }, []);

  return { draggingId, onDragStart, onDragMove, onDragEnd };
};
