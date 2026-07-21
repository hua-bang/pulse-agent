// Full-window pointer shield for drag gestures that can cross <webview> /
// iframe guests. A webview's guest process swallows the mousemove stream
// once the cursor enters it, deadlocking any host drag that relies on
// window-level listeners (canvas node drag/resize, dock panel resize).
// Callers mount the shield synchronously at mousedown — NOT via React
// state, whose commit can lag a frame behind the first drag motion — so
// hit-testing stays on the host for the whole gesture.
//
// Refcounted single element: independent gestures (a canvas node drag and
// a dock panel resize) share it, and the last release removes it.
let shieldEl: HTMLDivElement | null = null;
let activeUsers = 0;

/**
 * Mount (or share) the interaction shield under `parent` and return an
 * idempotent release function. The shield uses the existing
 * `.canvas-interaction-shield` class (z-index above the dock), so it also
 * covers dock link-tab webviews living outside the canvas container.
 */
export const acquireInteractionShield = (parent: HTMLElement = document.body): (() => void) => {
  activeUsers += 1;
  if (!shieldEl) {
    shieldEl = document.createElement('div');
    shieldEl.className = 'canvas-interaction-shield';
    parent.appendChild(shieldEl);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeUsers -= 1;
    if (activeUsers <= 0) {
      activeUsers = 0;
      shieldEl?.remove();
      shieldEl = null;
    }
  };
};
