import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import type { CanvasNode } from '../types';

interface Options {
  /** Live ref into the latest nodes array. The marquee handler doesn't
   *  read it directly, but consumers of the hook frequently need a
   *  matching `getAllNodes()` accessor so we surface a tiny helper. */
  nodesRef: MutableRefObject<CanvasNode[]>;
}

/**
 * Centralizes the canvas's selection-related state — selected node ids,
 * selected edge id, clipboard, highlighted id with auto-clear timer, and
 * the in-flight edge-label edit id. Exposes the click-handler logic for
 * single-node clicks (`handleSelectNode`) and marquee-driven multi-
 * select. The `suppressBlankClickRef` is shared with the root mouse
 * handlers so a click event that fires immediately after a marquee drag
 * doesn't fall through and wipe the selection we just made.
 */
export const useCanvasSelection = ({ nodesRef }: Options) => {
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [clipboardNodes, setClipboardNodes] = useState<CanvasNode[]>([]);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  // Which edge (if any) is in label-edit mode. Driven by dbl-click on
  // the edge body; cleared on blur/Escape/Enter. Stored here (not inside
  // EdgeLabel) so that selecting a different edge or deleting the edge
  // can forcibly end the edit session.
  const [editingEdgeLabelId, setEditingEdgeLabelId] = useState<string | null>(null);

  // Set to true at the end of a real marquee drag so the click event
  // that fires immediately afterward doesn't fall through to the blank-
  // canvas-click handler and wipe the selection we just made.
  const suppressBlankClickRef = useRef(false);

  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear highlight after the activation flash. Kept in this hook so
  // setHighlightedId callers don't have to manage the timer themselves.
  useEffect(() => {
    if (!highlightedId) return;
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 1500);
  }, [highlightedId]);

  const handleSelectNode = useCallback(
    (id: string, mods?: { shift?: boolean; meta?: boolean }) => {
      // Shift-click extends the selection (additive); Cmd/Ctrl-click
      // toggles the clicked id in/out of the selection. Plain click
      // collapses the selection to just this node — but only if it
      // wasn't already selected, so a click on a member of an
      // existing multi-selection preserves the group (matches Figma /
      // Finder semantics and keeps multi-drag from collapsing on the
      // mousedown that initiates it).
      if (mods?.shift || mods?.meta) {
        setSelectedNodeIds((current) =>
          current.includes(id) ? current.filter((cid) => cid !== id) : [...current, id],
        );
      } else {
        setSelectedNodeIds((current) =>
          current.length > 1 && current.includes(id) ? current : [id],
        );
      }
      setSelectedEdgeId(null);
    },
    [],
  );

  const handleMarqueeSelect = useCallback(
    (ids: string[], mods: { shift: boolean; meta: boolean }) => {
      // Suppress the click event that fires right after a real drag
      // (otherwise the blank-canvas click handler would clear what we
      // just selected). A zero-distance "drag" still falls through to
      // the click handler — that's how a plain click on blank canvas
      // continues to clear the selection.
      if (ids.length > 0) suppressBlankClickRef.current = true;

      if (mods.shift || mods.meta) {
        // The modifier explicitly says "extend", so even an empty-hit
        // click on blank canvas must NOT collapse the existing
        // selection. Suppress the trailing click handler regardless of
        // the hit count.
        suppressBlankClickRef.current = true;
        // Toggle each hit id in/out of the selection so a marquee with
        // shift extends the current group and a second pass over the
        // same nodes deselects them.
        setSelectedNodeIds((current) => {
          const next = new Set(current);
          for (const id of ids) {
            if (next.has(id)) next.delete(id);
            else next.add(id);
          }
          return Array.from(next);
        });
        if (ids.length > 0) setSelectedEdgeId(null);
        return;
      }

      // Plain marquee replaces the selection. An empty hit set on a
      // tiny drag falls through to the click handler that clears
      // selection — we don't double-clear here.
      if (ids.length > 0) {
        setSelectedNodeIds(ids);
        setSelectedEdgeId(null);
      }
    },
    [],
  );

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  const getAllNodes = useCallback(() => nodesRef.current, [nodesRef]);

  return {
    selectedNodeIds,
    setSelectedNodeIds,
    selectedEdgeId,
    setSelectedEdgeId,
    clipboardNodes,
    setClipboardNodes,
    highlightedId,
    setHighlightedId,
    editingEdgeLabelId,
    setEditingEdgeLabelId,
    suppressBlankClickRef,
    selectedNodeIdSet,
    handleSelectNode,
    handleMarqueeSelect,
    getAllNodes,
  };
};
