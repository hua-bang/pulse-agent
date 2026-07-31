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

/** Roomy width for a tab when the strip is not crowded (CSS `max-width`). */
export const TAB_MAX_WIDTH = 220;
/**
 * Floor for a shrunken tab. Measured, not guessed: below this the icon and
 * padding eat the row and the title truncates to a character or two, which
 * is not a label. Past the floor the strip scrolls instead — shrinking
 * further would trade one unusable state for another.
 */
export const TAB_MIN_WIDTH = 120;
/** Reserve for the strip's trailing controls (new tab, split, collapse). */
const TAB_STRIP_CONTROLS_WIDTH = 96;
/** Close button + shell spacing, which sit OUTSIDE the width this returns. */
const TAB_OVERHEAD = 26;

/**
 * Per-tab width for a strip holding `tabCount` tabs.
 *
 * Tabs used to be a fixed 108–220px, so the strip ran off the edge as soon as
 * a handful were open and the only way back to an off-screen tab was a
 * horizontal scroll with no scrollbar to hint at it. Browsers shrink instead,
 * which keeps more tabs directly clickable; this is that policy, bounded at
 * both ends.
 */
export const resolveTabWidth = (tabCount: number, dockWidth: number): number => {
  if (tabCount <= 0) return TAB_MAX_WIDTH;
  const available = Math.max(0, dockWidth - TAB_STRIP_CONTROLS_WIDTH);
  const share = Math.floor(available / tabCount) - TAB_OVERHEAD;
  return Math.max(TAB_MIN_WIDTH, Math.min(TAB_MAX_WIDTH, share));
};
