import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode } from '../../../types';

type Point = { x: number; y: number };

const EMPTY_HITS: CanvasNode[] = [];

export type MarqueeRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

interface UseMarqueeSelectOptions {
  /** Active when the select tool is on and no other tool (connect / shape /
   *  hand) owns canvas drags. Marquee never preempts those. */
  enabled: boolean;
  screenToCanvas: (x: number, y: number, el: HTMLElement) => Point;
  getContainer: () => HTMLElement | null;
  /** Snapshot of nodes used for hit-testing when the drag commits. */
  nodes: CanvasNode[];
  /** Called once on mouseup with every node id whose AABB intersects the
   *  marquee. The caller decides how to merge with the current selection
   *  (replace vs extend) based on shift/meta state captured at mousedown. */
  onSelect: (ids: string[], mods: { shift: boolean; meta: boolean }) => void;
}

/** Screen-pixel travel after which the gesture counts as a real drag. Until
 *  then it is still a click, so no interaction shield is mounted and the
 *  browser can deliver click / dblclick to the canvas. */
const DRAG_START_SCREEN_DISTANCE = 3;

const rectBetween = (a: Point, b: Point): MarqueeRect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(b.x - a.x),
  height: Math.abs(b.y - a.y),
});

/**
 * Nodes whose bounding box intersects the marquee. The intersection is
 * inclusive on both edges, so a marquee that exactly touches a node's edge
 * still picks it up. The live preview and the mouseup commit share it, so
 * the highlighted nodes are exactly the ones that get selected.
 */
export const marqueeHits = (nodes: readonly CanvasNode[], rect: MarqueeRect): CanvasNode[] => (
  nodes.filter((node) => (
    node.x + node.width >= rect.x
    && node.y + node.height >= rect.y
    && node.x <= rect.x + rect.width
    && node.y <= rect.y + rect.height
  ))
);

/**
 * Drag-on-blank-canvas multi-select. Mousedown on empty canvas starts a
 * draft rectangle; the rectangle follows the cursor until mouseup, at
 * which point every node whose bounding box intersects the rectangle is
 * passed to `onSelect`. A near-zero drag is ignored so simple clicks
 * still fall through to the canvas-click handler that clears selection.
 *
 * The hook does not own selection state — it just reports the hit set
 * and the modifier keys captured at mousedown so the caller can replace
 * or extend the selection.
 */
export const useMarqueeSelect = ({
  enabled,
  screenToCanvas,
  getContainer,
  nodes,
  onSelect,
}: UseMarqueeSelectOptions) => {
  const [marquee, setMarquee] = useState<{
    start: Point;
    current: Point;
    mods: { shift: boolean; meta: boolean };
    startClient: Point;
    dragging: boolean;
  } | null>(null);
  const marqueeRef = useRef<typeof marquee>(null);
  marqueeRef.current = marquee;
  // Snapshot of nodes captured at mousedown so the hit-test reflects the
  // canvas state when the drag started — moves/edits during a marquee
  // shouldn't change which nodes get selected.
  const snapshotRef = useRef<CanvasNode[]>([]);

  const isMarqueeActive = Boolean(marquee);

  useEffect(() => {
    if (!isMarqueeActive) return;
    const handleMove = (e: MouseEvent) => {
      const el = getContainer();
      if (!el) return;
      const cur = screenToCanvas(e.clientX, e.clientY, el);
      setMarquee((prev) => {
        if (!prev) return prev;
        const dragging = prev.dragging || Math.hypot(
          e.clientX - prev.startClient.x,
          e.clientY - prev.startClient.y,
        ) >= DRAG_START_SCREEN_DISTANCE;
        return { ...prev, current: cur, dragging };
      });
    };
    const handleUp = () => {
      const m = marqueeRef.current;
      setMarquee(null);
      if (!m) return;

      if (!m.dragging) {
        // Treat as a click — emit empty hit set so the caller can clear
        // selection on plain click, while shift/meta-click leaves it
        // alone. The caller distinguishes via the mods we hand back.
        onSelect([], m.mods);
        return;
      }

      const hits = marqueeHits(snapshotRef.current, rectBetween(m.start, m.current));
      onSelect(hits.map((node) => node.id), m.mods);
    };
    // Escape aborts the marquee without touching the selection. Capture
    // phase + stopPropagation so the canvas-level Escape handler doesn't
    // also clear the existing selection on the same press.
    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setMarquee(null);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('keydown', handleKey, true);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      window.removeEventListener('keydown', handleKey, true);
    };
  }, [isMarqueeActive, getContainer, screenToCanvas, onSelect]);

  const begin = useCallback(
    (e: React.MouseEvent) => {
      if (!enabled) return;
      if (e.button !== 0) return;
      // Alt-drag is reserved for panning in useCanvas — never start a
      // marquee in that case.
      if (e.altKey) return;
      const el = getContainer();
      if (!el) return;
      e.preventDefault();
      const start = screenToCanvas(e.clientX, e.clientY, el);
      snapshotRef.current = nodes;
      setMarquee({
        start,
        current: start,
        mods: { shift: e.shiftKey, meta: e.metaKey || e.ctrlKey },
        startClient: { x: e.clientX, y: e.clientY },
        dragging: false,
      });
    },
    [enabled, getContainer, screenToCanvas, nodes]
  );

  const rect = useMemo(
    () => (marquee ? rectBetween(marquee.start, marquee.current) : null),
    [marquee],
  );
  // Only real drags preview hits; a click stays a click. The overlay draws
  // these as outlines, so node views do not re-render while the box moves.
  const hits = useMemo(
    () => (rect && marquee?.dragging ? marqueeHits(snapshotRef.current, rect) : EMPTY_HITS),
    [marquee?.dragging, rect],
  );

  return {
    /** Live rectangle in canvas coordinates while a drag is in flight,
     *  null otherwise. The Canvas surface renders this as a dashed box. */
    rect,
    /** Nodes the marquee would select if released now. */
    hits,
    /** Mousedown handler to attach to the blank-canvas area. Bails out
     *  when the marquee is disabled or the drag is owned by another
     *  tool / pan gesture. */
    begin,
    /** True while a marquee drag is in progress. Useful for suppressing
     *  click handlers that would otherwise clear selection on mouseup. */
    active: marquee !== null,
    /** True once the pointer has travelled far enough to be a drag. The
     *  interaction shield waits for this so a plain click or double-click
     *  on blank canvas still reaches the canvas click handlers. */
    dragging: marquee?.dragging ?? false,
  };
};
