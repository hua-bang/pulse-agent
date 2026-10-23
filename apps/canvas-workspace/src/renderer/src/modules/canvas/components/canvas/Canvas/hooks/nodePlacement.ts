import type { CanvasNode } from '../../../../../../types';

/** Diagonal step applied when a proposed slot is already occupied.
 *  Matches the +24/+24 cascade used by `duplicateNode`/`pasteNodes`
 *  so consecutive adds and duplicates feel the same. */
const CASCADE_STEP = 24;
/** Two nodes whose top-lefts differ by less than this are treated as
 *  "the same slot". 12 is small enough that intentional partial
 *  overlap (e.g. dropping a text label onto a frame) is preserved,
 *  but large enough to catch the "user clicked the same toolbar
 *  button twice" case where the math would otherwise pixel-stack. */
const STACK_TOLERANCE = 12;
/** Upper bound on the cascade walk so we don't loop forever on a
 *  densely-filled diagonal. After this many tries we give up and let
 *  the cascaded position stand — still better than perfect overlap. */
const MAX_CASCADE_STEPS = 16;

/** Clear space kept between a toolbar-created node and its neighbours. */
const FREE_SLOT_GAP = 24;
/** Ring spacing for the free-slot search, in canvas pixels. */
const FREE_SLOT_STEP = 40;
/** Rings searched before falling back to the cascade (about 1600px out). */
const FREE_SLOT_MAX_RINGS = 40;

/** Walk diagonally from the desired top-left until we find a slot
 *  whose top-left doesn't sit on top of any existing node within
 *  `STACK_TOLERANCE` pixels. Used for cursor drops, where the user
 *  picked the spot and partial overlap is intended. */
export const resolveNonStackingSlot = (
  existing: readonly CanvasNode[],
  desiredX: number,
  desiredY: number,
): { x: number; y: number } => {
  let x = desiredX;
  let y = desiredY;
  for (let step = 0; step < MAX_CASCADE_STEPS; step += 1) {
    const collides = existing.some(
      (n) =>
        Math.abs(n.x - x) < STACK_TOLERANCE &&
        Math.abs(n.y - y) < STACK_TOLERANCE,
    );
    if (!collides) return { x, y };
    x += CASCADE_STEP;
    y += CASCADE_STEP;
  }
  return { x, y };
};

const overlapsAny = (
  existing: readonly CanvasNode[],
  x: number,
  y: number,
  width: number,
  height: number,
) =>
  existing.some(
    (n) =>
      x < n.x + n.width + FREE_SLOT_GAP &&
      x + width + FREE_SLOT_GAP > n.x &&
      y < n.y + n.height + FREE_SLOT_GAP &&
      y + height + FREE_SLOT_GAP > n.y,
  );

/**
 * Find the nearest top-left for a `width` x `height` node that overlaps no
 * existing node, searching square rings around the desired position.
 *
 * Frame and group membership is spatial (a node belongs to the container
 * that holds its centre), so a node dropped on top of others would join a
 * frame by accident, and a new frame would adopt everything under it. The
 * toolbar and palette have no user-chosen spot, so they must land in clear
 * space instead.
 */
export const findFreeSlot = (
  existing: readonly CanvasNode[],
  desiredX: number,
  desiredY: number,
  width: number,
  height: number,
): { x: number; y: number } => {
  if (!overlapsAny(existing, desiredX, desiredY, width, height)) {
    return { x: desiredX, y: desiredY };
  }
  for (let ring = 1; ring <= FREE_SLOT_MAX_RINGS; ring += 1) {
    const candidates: Array<{ x: number; y: number; distance: number }> = [];
    for (let i = -ring; i <= ring; i += 1) {
      for (let j = -ring; j <= ring; j += 1) {
        if (Math.max(Math.abs(i), Math.abs(j)) !== ring) continue;
        const x = desiredX + i * FREE_SLOT_STEP;
        const y = desiredY + j * FREE_SLOT_STEP;
        if (overlapsAny(existing, x, y, width, height)) continue;
        candidates.push({ x, y, distance: Math.hypot(i, j) });
      }
    }
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.distance - b.distance);
      return { x: candidates[0].x, y: candidates[0].y };
    }
  }
  return resolveNonStackingSlot(existing, desiredX, desiredY);
};
