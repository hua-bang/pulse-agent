/**
 * Pure derivations of `.canvas-transform`'s `transition` and `className`
 * from the current gesture/zoom state. Kept out of CanvasSurface.tsx so
 * these timing- and threshold-sensitive rules have a direct unit-test
 * surface (see CanvasSurface.test.ts) and CanvasSurface stays under the
 * file-size gate.
 */

const FIT_TRANSITION =
  'transform 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94), --canvas-scale 0.32s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
const SETTLE_TRANSITION = '--canvas-scale 140ms ease-out';

/**
 * The `.canvas-transform` CSS `transition` for the current animating/moving
 * combination:
 *  1. `animating && !moving` — a fit/focus call (useCanvasFit) is easing
 *     transform+scale toward a target. The `!moving` guard matters: without
 *     it, starting a wheel gesture within the 380ms fit-animation window
 *     kept this transition active, so every subsequent wheel tick re-eased
 *     from wherever the CSS interpolation currently sat instead of jumping
 *     straight to the new value — a rubber-band lag chasing the pointer.
 *     Gesturing cuts the transition immediately; the canvas snaps to the
 *     fit's current value and the gesture takes over clean.
 *  2. `moving` (mid-gesture, not animating) — no transition: transform must
 *     track the pointer/wheel with zero lag.
 *  3. otherwise (a gesture just settled, or fully idle) — glide
 *     `--canvas-scale` only (never `transform`, which isn't changing here)
 *     instead of snapping. Scale-compensated content (terminal glyphs via
 *     the ResizeObserver in TerminalNodeBody/useAgentNodeController, frame
 *     headers, node chrome) eases back to true size instead of popping the
 *     instant the gesture ends.
 */
export const getCanvasTransformTransition = (animating: boolean, moving: boolean): string | undefined => {
  if (animating && !moving) return FIT_TRANSITION;
  if (moving) return undefined;
  return SETTLE_TRANSITION;
};

/** Below this settled zoom, node chrome shrinks to icon-only (`--small`). */
const SMALL_SCALE_THRESHOLD = 0.6;
/**
 * Below this settled zoom, heavy live sub-content (webpage `<iframe>` /
 * `<webview>`) is swapped for a static placeholder card via the `--lod`
 * (level-of-detail) class. At <40% a web page is an unreadable thumbnail
 * anyway, and each live iframe is its own compositor layer — measured
 * (isolated trace harness, 40 webpage nodes) at ~500ms of per-gesture
 * main-thread Layerize, ~70% of which the placeholder reclaims. The node
 * stays fully mounted (only its inner content is `visibility:hidden`), so
 * there is no reload and no lost page state — just a one-time re-raster when
 * zooming back in past the threshold.
 */
export const LOD_SCALE_THRESHOLD = 0.4;

/**
 * `.canvas-transform`'s className for the current gesture/zoom state. All
 * three flags are driven by `settledScale` (the last resting zoom, frozen
 * mid-gesture) not the live scale, so the classes toggle once when a gesture
 * settles rather than thrashing — and a canvas already resting below a
 * threshold keeps that class for the whole of its next pan/zoom, which is
 * exactly when the cost matters.
 */
export const getCanvasTransformClassName = (
  moving: boolean,
  animating: boolean,
  settledScale: number,
): string => {
  let cls = 'canvas-transform';
  if (moving || animating) cls += ' canvas-transform--moving';
  if (settledScale < SMALL_SCALE_THRESHOLD) cls += ' canvas-transform--small';
  if (settledScale < LOD_SCALE_THRESHOLD) cls += ' canvas-transform--lod';
  return cls;
};
