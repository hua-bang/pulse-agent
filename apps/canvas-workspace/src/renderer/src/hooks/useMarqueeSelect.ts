import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasNode } from '../types';

type Point = { x: number; y: number };

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

/** Diagonal distance (canvas-px) below which a drag is treated as an
 *  accidental click and discarded. Same threshold as useShapeDraw. */
const DRAG_MIN_DISTANCE = 4;

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
  } | null>(null);
  const marqueeRef = useRef<typeof marquee>(null);
  marqueeRef.current = marquee;
  // Snapshot of nodes captured at mousedown so the hit-test reflects the
  // canvas state when the drag started — moves/edits during a marquee
  // shouldn't change which nodes get selected.
  const snapshotRef = useRef<CanvasNode[]>([]);

  useEffect(() => {
    if (!marquee) return;
    const handleMove = (e: MouseEvent) => {
      const el = getContainer();
      if (!el) return;
      const cur = screenToCanvas(e.clientX, e.clientY, el);
      setMarquee((prev) => (prev ? { ...prev, current: cur } : prev));
    };
    const handleUp = () => {
      const m = marqueeRef.current;
      setMarquee(null);
      if (!m) return;

      const dx = m.current.x - m.start.x;
      const dy = m.current.y - m.start.y;
      const dist = Math.hypot(dx, dy);
      if (dist < DRAG_MIN_DISTANCE) {
        // Treat as a click — emit empty hit set so the caller can clear
        // selection on plain click, while shift/meta-click leaves it
        // alone. The caller distinguishes via the mods we hand back.
        onSelect([], m.mods);
        return;
      }

      const rx = Math.min(m.start.x, m.current.x);
      const ry = Math.min(m.start.y, m.current.y);
      const rw = Math.abs(dx);
      const rh = Math.abs(dy);
      const hits: string[] = [];
      for (const n of snapshotRef.current) {
        const nx = n.x;
        const ny = n.y;
        const nw = n.width;
        const nh = n.height;
        // AABB intersect — inclusive on both edges so a marquee that
        // exactly touches a node's edge still picks it up.
        if (nx + nw < rx) continue;
        if (ny + nh < ry) continue;
        if (nx > rx + rw) continue;
        if (ny > ry + rh) continue;
        hits.push(n.id);
      }
      onSelect(hits, m.mods);
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [marquee, getContainer, screenToCanvas, onSelect]);

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
      });
    },
    [enabled, getContainer, screenToCanvas, nodes]
  );

  const rect: MarqueeRect | null = marquee
    ? {
        x: Math.min(marquee.start.x, marquee.current.x),
        y: Math.min(marquee.start.y, marquee.current.y),
        width: Math.abs(marquee.current.x - marquee.start.x),
        height: Math.abs(marquee.current.y - marquee.start.y),
      }
    : null;

  return {
    /** Live rectangle in canvas coordinates while a drag is in flight,
     *  null otherwise. The Canvas surface renders this as a dashed box. */
    rect,
    /** Mousedown handler to attach to the blank-canvas area. Bails out
     *  when the marquee is disabled or the drag is owned by another
     *  tool / pan gesture. */
    begin,
    /** True while a marquee drag is in progress. Useful for suppressing
     *  click handlers that would otherwise clear selection on mouseup. */
    active: marquee !== null,
  };
};
