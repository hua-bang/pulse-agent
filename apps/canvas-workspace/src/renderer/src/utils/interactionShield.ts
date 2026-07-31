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
const shieldedElementSet = new Set<HTMLElement>();
let shieldObserver: MutationObserver | null = null;

const shieldElement = (el: HTMLElement): void => {
  if (shieldedElementSet.has(el)) return;
  shieldedElementSet.add(el);
  shieldedElements.push({ el, prevPointerEvents: el.style.pointerEvents });
  el.style.pointerEvents = 'none';
};

const shieldGuestsIn = (root: ParentNode): void => {
  if (root instanceof HTMLElement && root.matches('webview, iframe')) shieldElement(root);
  for (const el of root.querySelectorAll<HTMLElement>('webview, iframe')) shieldElement(el);
};

/**
 * Shield every <webview> / <iframe> guest in the document (covers canvas
 * nodes and dock link tabs alike) and return an idempotent release
 * function.
 */
export const acquireInteractionShield = (): (() => void) => {
  activeUsers += 1;
  if (activeUsers === 1) {
    shieldGuestsIn(document);
    if (typeof MutationObserver !== 'undefined') {
      shieldObserver = new MutationObserver((records) => {
        for (const record of records) {
          for (const node of record.addedNodes) {
            if (node instanceof HTMLElement) shieldGuestsIn(node);
          }
        }
      });
      shieldObserver.observe(document.documentElement, { childList: true, subtree: true });
    }
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeUsers -= 1;
    if (activeUsers <= 0) {
      activeUsers = 0;
      shieldObserver?.disconnect();
      shieldObserver = null;
      for (const { el, prevPointerEvents } of shieldedElements) el.style.pointerEvents = prevPointerEvents;
      shieldedElements = [];
      shieldedElementSet.clear();
    }
  };
};
