import type { CanvasNode } from '../../../types';

/** Diagonal step between consecutive copies of plain nodes. */
const CASCADE_STEP = 24;
/** Clear space kept between a copied container and existing nodes. */
const CONTAINER_GAP = 40;
/** Placements tried to the right before falling back to the cascade. */
const MAX_TRIES = 12;

const bounds = (nodes: readonly CanvasNode[]) => {
  const left = Math.min(...nodes.map(node => node.x));
  const top = Math.min(...nodes.map(node => node.y));
  const right = Math.max(...nodes.map(node => node.x + node.width));
  const bottom = Math.max(...nodes.map(node => node.y + node.height));
  return { left, top, width: right - left, height: bottom - top };
};

const overlapsAny = (
  existing: readonly CanvasNode[],
  box: { left: number; top: number; width: number; height: number },
) => existing.some(node =>
  box.left < node.x + node.width + CONTAINER_GAP
  && box.left + box.width + CONTAINER_GAP > node.x
  && box.top < node.y + node.height + CONTAINER_GAP
  && box.top + box.height + CONTAINER_GAP > node.y);

/**
 * Offset for a pasted or duplicated selection.
 *
 * Frame and group membership is spatial: a node belongs to the container
 * that holds its centre. A copy of a frame placed 24px from the original
 * lands inside it and becomes its child, or swallows the original. So a
 * selection that holds a container moves right of its source into clear
 * space. Plain nodes keep the small cascade, so a copy stays in the frame
 * its source is in.
 */
export const pasteOffset = (
  sources: readonly CanvasNode[],
  existing: readonly CanvasNode[],
): { x: number; y: number } => {
  const cascade = { x: CASCADE_STEP, y: CASCADE_STEP };
  if (sources.length === 0) return cascade;
  if (!sources.some(node => node.type === 'frame' || node.type === 'group')) return cascade;
  const box = bounds(sources);
  for (let attempt = 1; attempt <= MAX_TRIES; attempt += 1) {
    const x = attempt * (box.width + CONTAINER_GAP);
    if (!overlapsAny(existing, { ...box, left: box.left + x })) return { x, y: 0 };
  }
  return cascade;
};
