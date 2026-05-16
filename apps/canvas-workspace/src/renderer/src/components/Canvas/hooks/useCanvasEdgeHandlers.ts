import { useCallback } from 'react';

interface Options {
  beginConnect: (x: number, y: number) => void;
  beginMoveEnd: (edgeId: string, handle: 'source' | 'target', x: number, y: number) => void;
  beginMoveBend: (
    edgeId: string,
    s: { x: number; y: number },
    t: { x: number; y: number },
    x: number,
    y: number,
  ) => void;
  beginMoveEdge: (edgeId: string, x: number, y: number) => void;
  updateEdge: (id: string, patch: { label?: string | undefined }) => void;
  setSelectedEdgeId: (id: string | null) => void;
  setSelectedNodeIds: (ids: string[]) => void;
  setEditingEdgeLabelId: (id: string | null) => void;
}

/**
 * Bundles every edge-interaction callback exposed to the surface and
 * overlays layers: connect-overlay drag, endpoint / bend / body drags,
 * and the label-edit lifecycle (start / commit / cancel). Pure
 * callbacks — keeps the parent's body free of glue code.
 */
export const useCanvasEdgeHandlers = ({
  beginConnect,
  beginMoveEnd,
  beginMoveBend,
  beginMoveEdge,
  updateEdge,
  setSelectedEdgeId,
  setSelectedNodeIds,
  setEditingEdgeLabelId,
}: Options) => {
  const handleEdgeHandleMouseDown = useCallback(
    (
      edgeId: string,
      handle: 'source' | 'target' | 'bend',
      e: React.MouseEvent,
      ctx: { s: { x: number; y: number }; t: { x: number; y: number } },
    ) => {
      if (handle === 'bend') beginMoveBend(edgeId, ctx.s, ctx.t, e.clientX, e.clientY);
      else beginMoveEnd(edgeId, handle, e.clientX, e.clientY);
    },
    [beginMoveBend, beginMoveEnd],
  );

  const handleConnectOverlayMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      beginConnect(e.clientX, e.clientY);
    },
    [beginConnect],
  );

  const handleEdgeBodyMouseDown = useCallback(
    (edgeId: string, e: React.MouseEvent) => {
      if (e.button !== 0) return;
      beginMoveEdge(edgeId, e.clientX, e.clientY);
    },
    [beginMoveEdge],
  );

  const handleEdgeBodyDoubleClick = useCallback(
    (edgeId: string) => {
      // Ensure the edge is selected before editing so the style panel
      // stays in sync with the edge the user is labeling.
      setSelectedEdgeId(edgeId);
      setSelectedNodeIds([]);
      setEditingEdgeLabelId(edgeId);
    },
    [setSelectedEdgeId, setSelectedNodeIds, setEditingEdgeLabelId],
  );

  const handleCommitEditEdgeLabel = useCallback(
    (edgeId: string, label: string) => {
      // Normalize: empty or whitespace-only labels clear the field back
      // to `undefined`, keeping the stored data clean (and making the
      // label chip disappear from the overlay).
      const trimmed = label.trim();
      updateEdge(edgeId, { label: trimmed.length > 0 ? trimmed : undefined });
      setEditingEdgeLabelId(null);
    },
    [updateEdge, setEditingEdgeLabelId],
  );

  const handleCancelEditEdgeLabel = useCallback(() => {
    setEditingEdgeLabelId(null);
  }, [setEditingEdgeLabelId]);

  return {
    handleEdgeHandleMouseDown,
    handleConnectOverlayMouseDown,
    handleEdgeBodyMouseDown,
    handleEdgeBodyDoubleClick,
    handleCommitEditEdgeLabel,
    handleCancelEditEdgeLabel,
  };
};
