/** Screen-px band along each viewport side that starts an auto-pan. */
export const EDGE_PAN_ZONE_PX = 48;
/** Fastest pan step, in screen px per frame, at or past the edge. */
export const EDGE_PAN_MAX_STEP_PX = 18;

interface ViewportRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const axisStep = (pointer: number, start: number, end: number): number => {
  // Content moves toward the pointer's side: positive near the start edge
  // (reveals what is left/above), negative near the end edge.
  const fromStart = pointer - start;
  if (fromStart < EDGE_PAN_ZONE_PX) {
    return EDGE_PAN_MAX_STEP_PX * Math.min(1, 1 - fromStart / EDGE_PAN_ZONE_PX);
  }
  const fromEnd = end - pointer;
  if (fromEnd < EDGE_PAN_ZONE_PX) {
    return -EDGE_PAN_MAX_STEP_PX * Math.min(1, 1 - fromEnd / EDGE_PAN_ZONE_PX);
  }
  return 0;
};

/**
 * Pan step for a drag whose pointer is near a viewport edge. The step grows
 * as the pointer nears the edge and stays at its maximum past it. Returns
 * zero away from every edge.
 */
export const edgePanStep = (
  pointer: { x: number; y: number },
  viewport: ViewportRect,
): { dx: number; dy: number } => ({
  dx: Math.round(axisStep(pointer.x, viewport.left, viewport.right)),
  dy: Math.round(axisStep(pointer.y, viewport.top, viewport.bottom)),
});
