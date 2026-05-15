import { useCallback, useEffect, useRef, useState } from "react";
import type { CanvasNode } from "../types";
import { collectContainerDescendants, isContainerNode } from "../utils/frameHierarchy";
import { computeSnap, type SnapBox, type SnapLine } from "../utils/canvasSnapping";

/** Grid spacing (canvas-px) for the fallback grid snap. Lines up with
 *  the existing background `.canvas-grid` so the snap and the visual
 *  grid agree. Set to 0 to disable grid snap entirely. */
const GRID_SIZE = 8;

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
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const dragging = useRef<{
    id: string;
    startX: number;
    startY: number;
    nodeX: number;
    nodeY: number;
    /** Primary node bounds — captured once so the snap algorithm can
     *  compute the dragged box's edges/centers without re-resolving
     *  the node from `nodes` on every mousemove. */
    width: number;
    height: number;
    /** Snap candidates: every node NOT participating in the drag. Frozen
     *  at drag start so a long drag isn't paying for hit-testing against
     *  changing geometry mid-stroke. */
    snapCandidates: SnapBox[];
    /** Companions that move with the primary node — container descendants
     *  and (when the primary is part of the active selection) every
     *  other selected node. */
    companions: Array<{ id: string; nodeX: number; nodeY: number }>;
  } | null>(null);
  const lastMoveEvent = useRef<React.MouseEvent | MouseEvent | null>(null);
  const moveFrame = useRef<number | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // Every node that moves with the drag (the primary node plus, for containers,
  // every descendant container / node, plus every other selected node when the
  // primary is part of the active selection). Used so the whole group can
  // share the lifted `.canvas-node--dragging` stacking context — otherwise
  // a dragged parent frame/group could paint over its nested
  // children, and multi-drag would visually only lift one node.
  const [draggingIds, setDraggingIds] = useState<Set<string>>(() => new Set());
  // Active alignment guides for the current drag. Cleared on dragEnd.
  // Lives in state so the Canvas can render them without re-computing
  // snap in two places.
  const [snapLines, setSnapLines] = useState<SnapLine[]>([]);

  const onDragStart = useCallback(
    (e: React.MouseEvent, node: CanvasNode) => {
      if (e.button !== 0 || e.altKey) return;
      e.stopPropagation();
      e.preventDefault();

      const currentNodes = nodesRef.current;
      const currentSelectedIds = selectedIdsRef.current;
      const companionMap = new Map<string, { id: string; nodeX: number; nodeY: number }>();

      // If dragging a container, also drag every transitive descendant — both
      // regular nodes and nested child containers.
      if (isContainerNode(node)) {
        for (const desc of collectContainerDescendants(node.id, currentNodes)) {
          companionMap.set(desc.id, { id: desc.id, nodeX: desc.x, nodeY: desc.y });
        }
      }

      // Multi-select drag: if the primary node is part of the active
      // selection, every other selected node tags along (and, recursively,
      // their container descendants — so dragging a selected frame/group
      // still moves its children).
      if (currentSelectedIds.includes(node.id) && currentSelectedIds.length > 1) {
        const nodeById = new Map(currentNodes.map((n) => [n.id, n] as const));
        for (const id of currentSelectedIds) {
          if (id === node.id) continue;
          const peer = nodeById.get(id);
          if (!peer) continue;
          companionMap.set(peer.id, { id: peer.id, nodeX: peer.x, nodeY: peer.y });
          if (isContainerNode(peer)) {
            for (const desc of collectContainerDescendants(peer.id, currentNodes)) {
              if (desc.id === node.id) continue;
              if (!companionMap.has(desc.id)) {
                companionMap.set(desc.id, { id: desc.id, nodeX: desc.x, nodeY: desc.y });
              }
            }
          }
        }
      }

      const companions = Array.from(companionMap.values());
      // Snap candidates exclude the primary and every companion — we
      // don't want a dragged group to snap to itself.
      const dragSet = new Set([node.id, ...companions.map((c) => c.id)]);
      const snapCandidates: SnapBox[] = currentNodes
        .filter((n) => !dragSet.has(n.id))
        .map((n) => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }));

      dragging.current = {
        id: node.id,
        startX: e.clientX,
        startY: e.clientY,
        nodeX: node.x,
        nodeY: node.y,
        width: node.width,
        height: node.height,
        snapCandidates,
        companions,
      };
      setDraggingId(node.id);
      setDraggingIds(new Set(dragSet));
    },
    []
  );

  const flushDragMove = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      if (!dragging.current) return;
      const d = dragging.current;
      const rawDx = (e.clientX - d.startX) / scale;
      const rawDy = (e.clientY - d.startY) / scale;
      const baseX = d.nodeX + rawDx;
      const baseY = d.nodeY + rawDy;

      // Hold Cmd/Ctrl during a drag to opt out of snapping for fine
      // positioning — matches the Figma/Sketch convention. Ctrl is the
      // modifier on Linux/Windows; Cmd on macOS.
      const snapDisabled = e.metaKey || e.ctrlKey;

      let finalX = baseX;
      let finalY = baseY;

      if (!snapDisabled) {
        const snap = computeSnap(
          { x: baseX, y: baseY, width: d.width, height: d.height },
          d.snapCandidates,
          { scale, gridSize: GRID_SIZE },
        );
        finalX = baseX + snap.dx;
        finalY = baseY + snap.dy;
        // Update guides only when they change to avoid pointless renders
        // every mousemove tick. Compare by reference-equivalent
        // serialization — guides are short arrays so this is cheap.
        setSnapLines((prev) => {
          if (prev.length !== snap.lines.length) return snap.lines;
          for (let i = 0; i < prev.length; i++) {
            const a = prev[i];
            const b = snap.lines[i];
            if (
              a.axis !== b.axis ||
              a.position !== b.position ||
              a.start !== b.start ||
              a.end !== b.end
            ) {
              return snap.lines;
            }
          }
          return prev;
        });
      } else {
        setSnapLines((prev) => (prev.length === 0 ? prev : []));
      }

      const appliedDx = finalX - d.nodeX;
      const appliedDy = finalY - d.nodeY;

      if (d.companions.length > 0) {
        // Batch move primary + every companion in one applyNodes call so
        // the whole group reflects the same delta in one render.
        const moves = [
          { id: d.id, x: finalX, y: finalY },
          ...d.companions.map((c) => ({
            id: c.id,
            x: c.nodeX + appliedDx,
            y: c.nodeY + appliedDy,
          })),
        ];
        moveNodes(moves);
      } else {
        moveNode(d.id, finalX, finalY);
      }
    },
    [moveNode, moveNodes, scale]
  );

  const onDragMove = useCallback(
    (e: React.MouseEvent | MouseEvent) => {
      lastMoveEvent.current = e;
      if (moveFrame.current !== null) return;
      moveFrame.current = requestAnimationFrame(() => {
        moveFrame.current = null;
        const nextEvent = lastMoveEvent.current;
        if (nextEvent) flushDragMove(nextEvent);
      });
    },
    [flushDragMove]
  );

  const onDragEnd = useCallback(() => {
    if (moveFrame.current !== null) {
      cancelAnimationFrame(moveFrame.current);
      moveFrame.current = null;
    }
    const nextEvent = lastMoveEvent.current;
    if (nextEvent) {
      flushDragMove(nextEvent);
      lastMoveEvent.current = null;
    }
    dragging.current = null;
    setDraggingId(null);
    setDraggingIds(new Set());
    setSnapLines([]);
  }, [flushDragMove]);

  useEffect(() => {
    return () => {
      if (moveFrame.current !== null) {
        cancelAnimationFrame(moveFrame.current);
      }
    };
  }, []);

  return { draggingId, draggingIds, snapLines, onDragStart, onDragMove, onDragEnd };
};
