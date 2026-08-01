import { useEffect, useRef } from 'react';
import { isImeComposing } from '../utils/ime';

/**
 * Every active subscriber, oldest first; only the LAST one sees an Escape.
 *
 * Each subscriber used to install its own capture-phase listener on
 * `document` and call `stopPropagation()`. That stops the event travelling
 * DOWN, but never reaches sibling listeners on the same node, and those run
 * in registration order — so the overlay that opened FIRST answered first.
 * Opening a `ui/Select` inside a `ui/Modal` and pressing Escape (the ordinary
 * "close this menu" gesture) therefore tore down the whole modal, discarding
 * an unsaved form. `stopImmediatePropagation` cannot fix it either: the
 * modal's listener is already registered by the time the menu opens, so it
 * still runs first.
 *
 * One shared listener dispatching to the top of a LIFO stack gives the
 * innermost overlay the press, which is what "Escape closes this" means
 * everywhere else.
 */
type Subscriber = { current: () => void };

const stack: Subscriber[] = [];
let listening = false;

const handleKeyDown = (event: KeyboardEvent) => {
  // IME-composition Escapes dismiss the candidate window, not the popover.
  if (event.key !== 'Escape' || isImeComposing(event)) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  // Consumed by the topmost overlay, so it never also reaches window-level
  // shortcut handlers (canvas deselect, drawer close, …) or the bubble-phase
  // Escape owners (`NodeDetailPage`, text fields).
  event.stopPropagation();
  top.current();
};

const pushSubscriber = (subscriber: Subscriber): void => {
  stack.push(subscriber);
  if (listening) return;
  document.addEventListener('keydown', handleKeyDown, true);
  listening = true;
};

const removeSubscriber = (subscriber: Subscriber): void => {
  const index = stack.lastIndexOf(subscriber);
  if (index !== -1) stack.splice(index, 1);
  if (stack.length || !listening) return;
  // With nothing open, Escape must reach everyone else untouched.
  document.removeEventListener('keydown', handleKeyDown, true);
  listening = false;
};

/**
 * Escape-closes a popover/menu/dialog while it is open. The innermost open
 * subscriber wins; see the note above for why registration order alone does
 * not deliver that.
 */
export const useEscapeClose = (active: boolean, onClose: () => void) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    // The ref object is a stable per-instance identity, so re-renders never
    // reorder the stack — only activation and teardown do.
    pushSubscriber(onCloseRef);
    return () => removeSubscriber(onCloseRef);
  }, [active]);
};

/** Test-only: the layering is global, so a leaked subscriber breaks the next test. */
export const __escapeStackDepth = (): number => stack.length;
