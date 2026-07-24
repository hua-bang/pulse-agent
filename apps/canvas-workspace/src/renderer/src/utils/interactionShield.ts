// Pointer shield for drag gestures that can cross <webview> / <iframe>
// guests. A webview's guest process (or a sandboxed iframe) swallows the
// mousemove stream once the cursor enters it, deadlocking any host drag
// that relies on window-level listeners (canvas node drag/resize, dock
// panel resize). Callers acquire the shield synchronously at mousedown —
// NOT via React state, whose commit can lag a frame behind the first drag
// motion — so hit-testing stays on the host for the whole gesture.
//
// This used to insert one full-viewport `position:fixed` div above
// everything. That also broke plain clicks: the div, not the node the user
// actually pressed, became the mouseup hit-test target (mounted at
// mousedown, and mouseup's target is resolved before any JS handler — ours
// included — gets a chance to remove it), so the browser never synthesized
// a trailing click/dblclick when the gesture had no motion in between —
// silently breaking "double-click a node title to rename" and similar.
//
// Setting `pointer-events: none` directly on the guest elements gives the
// same protection (hit-testing falls through to whatever is beneath the
// guest — verified against a live <webview>) without ever standing in
// front of ordinary UI, so an unmoved mousedown/mouseup pair still resolves
// on the real element.
//
// Refcounted: independent gestures (a canvas node drag and a dock panel
// resize) share one acquisition; the last release restores every touched
// element's own prior inline pointer-events value.
let activeUsers = 0;
let shieldedElements: Array<{ el: HTMLElement; prevPointerEvents: string }> = [];

/**
 * Shield every <webview> / <iframe> guest in the document (covers canvas
 * nodes and dock link tabs alike) and return an idempotent release
 * function.
 */
export const acquireInteractionShield = (): (() => void) => {
  activeUsers += 1;
  if (shieldedElements.length === 0) {
    shieldedElements = Array.from(document.querySelectorAll<HTMLElement>('webview, iframe')).map((el) => ({
      el,
      prevPointerEvents: el.style.pointerEvents,
    }));
    for (const { el } of shieldedElements) el.style.pointerEvents = 'none';
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeUsers -= 1;
    if (activeUsers <= 0) {
      activeUsers = 0;
      for (const { el, prevPointerEvents } of shieldedElements) el.style.pointerEvents = prevPointerEvents;
      shieldedElements = [];
    }
  };
};
