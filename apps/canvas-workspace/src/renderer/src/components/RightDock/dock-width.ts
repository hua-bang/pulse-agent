/** Dock width policy.
 *
 * Two different jobs share one panel. On the canvas the dock is a working
 * surface: the canvas reflows behind it and panning/zooming still works in
 * whatever strip is left, so dragging it to nearly full screen is legitimate.
 * On the page routes (AI Chat, Nodes, Skills, Scheduled, plugin pages) the
 * page itself is the content — letting the dock eat 95% of the viewport
 * squeezes a chat thread or a task list into an unusable gutter, which is why
 * those routes cap it. The cap still leaves the page a working strip (30% of
 * a 1600px viewport is ~480px, the dock's own default width) rather than
 * letting a wide docked link tab (a Feishu doc, a code diff) push it to a
 * sliver.
 *
 * The cap applies to the RENDERED width only. `RightDock` keeps the user's
 * chosen width untouched and derives the effective width per route, so
 * canvas → page shrinks the dock and page → canvas restores it instead of
 * quietly overwriting the preference with the capped value.
 */
export const DOCK_MIN_WIDTH = 320;
export const DOCK_DEFAULT_WIDTH = 480;

const CANVAS_MAX_VIEWPORT_RATIO = 0.95;
const PAGE_MAX_VIEWPORT_RATIO = 0.7;

export const resolveDockMaxWidth = (viewportWidth: number, capped: boolean): number => {
  const ratio = capped ? PAGE_MAX_VIEWPORT_RATIO : CANVAS_MAX_VIEWPORT_RATIO;
  return Math.max(DOCK_MIN_WIDTH, Math.round(viewportWidth * ratio));
};

export const clampDockWidth = (value: number, viewportWidth: number, capped: boolean): number => (
  Math.min(resolveDockMaxWidth(viewportWidth, capped), Math.max(DOCK_MIN_WIDTH, Math.round(value)))
);
