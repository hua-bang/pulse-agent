/**
 * Drag-time snapping for canvas nodes. Pure functions, no React state.
 *
 * Two snapping modes are layered:
 *   1. Object snap — align the dragged box's edges/centers with any
 *      other node's edges/centers. Stronger of the two; if it engages,
 *      grid snap is skipped along that axis.
 *   2. Grid snap — fallback that pulls the box's top-left corner onto
 *      the nearest multiple of the grid size. Only kicks in when no
 *      object alignment is close enough on a given axis.
 *
 * Both axes are computed independently — a drag can snap on X to one
 * neighbor and on Y to a different neighbor.
 */

export type SnapBox = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type SnapLine = {
  /** Which axis the line lives on. An "x" line is vertical (constant X),
   *  drawn between two Y extents. */
  axis: 'x' | 'y';
  /** Coordinate of the line in canvas space (the X for vertical lines,
   *  the Y for horizontal). */
  position: number;
  /** Extent of the line on the perpendicular axis (canvas coordinates).
   *  Lines render between these two values so the guide visually
   *  connects the dragged box to the neighbor it's snapping to,
   *  instead of spanning the whole canvas. */
  start: number;
  end: number;
};

export type SnapResult = {
  /** Delta to apply to the dragged box's top-left so it lands on the
   *  snapped position. Add to the unsnapped (x, y) to get the final
   *  position. Either component can be 0 if no snap engaged on that
   *  axis. */
  dx: number;
  dy: number;
  /** Visible alignment guides for the active snap. Empty when nothing
   *  snapped (or when only grid snap engaged — grid is communicated
   *  via the existing background grid, not extra lines). */
  lines: SnapLine[];
};

export type SnapOptions = {
  /** Active zoom (scale) — used to keep the snap threshold constant in
   *  screen pixels even as the user zooms in/out. */
  scale: number;
  /** Grid spacing in canvas pixels. Set to 0 to disable grid snap. */
  gridSize: number;
  /** Threshold in screen pixels: anything closer than this snaps. */
  thresholdPx?: number;
};

const DEFAULT_THRESHOLD_PX = 6;

type AxisLine = {
  /** Position along the axis being snapped. */
  pos: number;
  /** Which feature of the box this line represents. Used to label /
   *  prioritize ties (currently unused by the renderer but handy for
   *  future "edge-vs-center" weighting). */
  kind: 'start' | 'center' | 'end';
};

const linesFor = (start: number, size: number): AxisLine[] => [
  { pos: start, kind: 'start' },
  { pos: start + size / 2, kind: 'center' },
  { pos: start + size, kind: 'end' },
];

type AxisSnap = {
  /** Distance between the dragged line and the matched line, in canvas
   *  pixels. The closest match wins. */
  dist: number;
  /** Snapped coordinate (where the matched line sits). */
  position: number;
  /** Required move so the dragged box aligns: add to the dragged
   *  feature's current coordinate to land on `position`. */
  delta: number;
  /** Every "other" box that contributes a line at exactly `position`,
   *  so the renderer can extend the guide across all of them. */
  matchedBoxes: SnapBox[];
};

const findBestAxisSnap = (
  draggedLines: AxisLine[],
  others: SnapBox[],
  axis: 'x' | 'y',
  threshold: number,
): AxisSnap | null => {
  let best: AxisSnap | null = null;
  for (const dragged of draggedLines) {
    for (const other of others) {
      const start = axis === 'x' ? other.x : other.y;
      const size = axis === 'x' ? other.width : other.height;
      const otherLines = linesFor(start, size);
      for (const ol of otherLines) {
        const dist = Math.abs(dragged.pos - ol.pos);
        if (dist > threshold) continue;
        if (!best || dist < best.dist - 0.001) {
          best = {
            dist,
            position: ol.pos,
            delta: ol.pos - dragged.pos,
            matchedBoxes: [other],
          };
        } else if (Math.abs(dist - best.dist) < 0.001 && best.position === ol.pos) {
          // Same coordinate as the current best — extend the guide to
          // cover this neighbor too.
          best.matchedBoxes.push(other);
        }
      }
    }
  }
  return best;
};

export const computeSnap = (
  dragged: { x: number; y: number; width: number; height: number },
  others: SnapBox[],
  options: SnapOptions,
): SnapResult => {
  const { scale, gridSize, thresholdPx = DEFAULT_THRESHOLD_PX } = options;
  // Convert the screen-pixel threshold into canvas pixels so the snap
  // "feel" stays constant as the user zooms.
  const threshold = thresholdPx / Math.max(scale, 0.0001);

  const xLines = linesFor(dragged.x, dragged.width);
  const yLines = linesFor(dragged.y, dragged.height);

  const bestX = findBestAxisSnap(xLines, others, 'x', threshold);
  const bestY = findBestAxisSnap(yLines, others, 'y', threshold);

  let dx = 0;
  let dy = 0;
  const lines: SnapLine[] = [];

  if (bestX) {
    dx = bestX.delta;
    // Span the guide from the topmost involved box to the bottommost,
    // including the (post-snap) dragged box. Bit of padding so the
    // line visually exits past both bounds.
    const ys = [
      dragged.y,
      dragged.y + dragged.height,
      ...bestX.matchedBoxes.flatMap((b) => [b.y, b.y + b.height]),
    ];
    lines.push({
      axis: 'x',
      position: bestX.position,
      start: Math.min(...ys),
      end: Math.max(...ys),
    });
  } else if (gridSize > 0) {
    // Grid fallback for X — snap top-left to nearest grid multiple.
    const snapped = Math.round(dragged.x / gridSize) * gridSize;
    if (Math.abs(snapped - dragged.x) <= threshold) {
      dx = snapped - dragged.x;
    }
  }

  if (bestY) {
    dy = bestY.delta;
    const xs = [
      dragged.x,
      dragged.x + dragged.width,
      ...bestY.matchedBoxes.flatMap((b) => [b.x, b.x + b.width]),
    ];
    lines.push({
      axis: 'y',
      position: bestY.position,
      start: Math.min(...xs),
      end: Math.max(...xs),
    });
  } else if (gridSize > 0) {
    const snapped = Math.round(dragged.y / gridSize) * gridSize;
    if (Math.abs(snapped - dragged.y) <= threshold) {
      dy = snapped - dragged.y;
    }
  }

  return { dx, dy, lines };
};
