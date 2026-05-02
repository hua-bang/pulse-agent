import { useCallback, useRef, useState } from "react";
import type { CanvasNode } from "../types";
import { collectFrameDescendants } from "../utils/frameHierarchy";

export const useNodeDrag = (
  moveNode: (id: string, x: number, y: number) => void,
  moveNodes: (moves: Array<{ id: string; x: number; y: number }>) => void,
  scale: number,
  nodes: CanvasNode[],
  /** Ids currently selected on the canvas. When the dragged node is part
   *  of this set we drag the whole selection together, preserving each
   *  node's offset relative to the primary one. Empty / single-id drags
   *  fall back to the original "drag this node alone" behavior. */
  selectedIds: string[] = []
) => {
  const dragging = useRef<{
    id: string;
    startX: number;
    startY: number;
    nodeX: number;
    nodeY: number;
    /** Companions that move with the primary node — frame descendants
     *  and (when the primary is part of the active selection) every
     *  other selected node. */
    companions: Array<{ id: string; nodeX: number; nodeY: number }>;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Every node that moves with the drag (the primary node plus, for frames,
  // every descendant frame / node, plus every other selected node when the
  // primary is part of the active selection). Used so the whole group can
  // share the lifted `.canvas-node--dragging` stacking context — otherwise
  // a dragged parent frame's opaque body would paint over its nested
  // children, and multi-drag would visually only lift one node.
  const [draggingIds, setDraggingIds] = useState<Set<string>>(() => new Set());

  const onDragStart = useCallback(
    (e: React.MouseEvent, node: CanvasNode) => {
      if (e.button !== 0 || e.altKey) return;
      e.stopPropagation();

      const companionMap = new Map<string, { id: string; nodeX: number; nodeY: number }>();

      // If dragging a frame, also drag every transitive descendant — both
      // regular nodes and nested child frames.
      if (node.type === "frame") {
        for (const desc of collectFrameDescendants(node.id, nodes)) {
          companionMap.set(desc.id, { id: desc.id, nodeX: desc.x, nodeY: desc.y });
        }
      }

      // Multi-select drag: if the primary node is part of the active
      // selection, every other selected node tags along (and, recursively,
      // their frame descendants — so dragging a selected frame still moves
      // its children).
      if (selectedIds.includes(node.id) && selectedIds.length > 1) {
        const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
        for (const id of selectedIds) {
          if (id === node.id) continue;
          const peer = nodeById.get(id);
          if (!peer) continue;
          companionMap.set(peer.id, { id: peer.id, nodeX: peer.x, nodeY: peer.y });
          if (peer.type === "frame") {
            for (const desc of collectFrameDescendants(peer.id, nodes)) {
              if (desc.id === node.id) continue;
              if (!companionMap.has(desc.id)) {
                companionMap.set(desc.id, { id: desc.id, nodeX: desc.x, nodeY: desc.y });
              }
            }
          }
        }
      }

      const companions = Array.from(companionMap.values());

      dragging.current = {
        id: node.id,
        startX: e.clientX,
        startY: e.clientY,
        nodeX: node.x,
        nodeY: node.y,
        companions,
      };
      setDraggingId(node.id);
      setDraggingIds(new Set([node.id, ...companions.map((c) => c.id)]));
    },
    [nodes, selectedIds]
  );

  const onDragMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging.current) return;
      const d = dragging.current;
      const dx = (e.clientX - d.startX) / scale;
      const dy = (e.clientY - d.startY) / scale;

      if (d.companions.length > 0) {
        // Batch move primary + every companion in one applyNodes call so
        // the whole group reflects the same delta in one render.
        const moves = [
          { id: d.id, x: d.nodeX + dx, y: d.nodeY + dy },
          ...d.companions.map((c) => ({
            id: c.id,
            x: c.nodeX + dx,
            y: c.nodeY + dy,
          })),
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
    setDraggingIds(new Set());
  }, []);

  return { draggingId, draggingIds, onDragStart, onDragMove, onDragEnd };
};
