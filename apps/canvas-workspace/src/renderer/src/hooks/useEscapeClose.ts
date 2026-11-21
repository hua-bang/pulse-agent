import { useEffect, useRef } from 'react';
import { isImeComposing } from '../utils/ime';

type EscapeEntry = {
  close: () => void;
  /** Render order. A higher value is the visually inner overlay. */
  order: number;
  shouldIgnore?: (e: KeyboardEvent) => boolean;
};

const escapeStack: EscapeEntry[] = [];
let listenerAttached = false;
let nextEscapeOrder = 0;

const insertEscapeEntry = (entry: EscapeEntry) => {
  const index = escapeStack.findIndex((item) => item.order > entry.order);
  if (index === -1) escapeStack.push(entry);
  else escapeStack.splice(index, 0, entry);
};

const handleDocumentEscape = (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || isImeComposing(e) || escapeStack.length === 0) return;
  const top = escapeStack[escapeStack.length - 1];
  if (top.shouldIgnore?.(e)) return;
  e.stopPropagation();
  e.stopImmediatePropagation();
  top.close();
};

const syncDocumentListener = () => {
  if (escapeStack.length > 0 && !listenerAttached) {
    document.addEventListener('keydown', handleDocumentEscape, true);
    listenerAttached = true;
  } else if (escapeStack.length === 0 && listenerAttached) {
    document.removeEventListener('keydown', handleDocumentEscape, true);
    listenerAttached = false;
  }
};

/**
 * Escape-closes a popover/menu/dialog while it's open. Uses a LIFO stack on a
 * single capture-phase `document` listener so Escape is consumed strictly by
 * the topmost open overlay (e.g. a Select inside a Modal closes the Select
 * without closing the Modal) and never reaches window-level shortcut handlers.
 * IME-composition Escapes are ignored — those dismiss the candidate window.
 *
 * Stack order is the render order, not the effect order. In one commit, child
 * effects run before parent effects, so pushing inside the effect puts the
 * outer Modal above a menu that mounted with it. The parent renders first, so
 * it receives the lower order and Escape closes the inner overlay first. A
 * portaled menu is not a DOM descendant of the Modal, so containment cannot
 * decide this.
 */
export const useEscapeClose = (
  active: boolean,
  onClose: () => void,
  options?: { shouldIgnore?: (e: KeyboardEvent) => boolean },
) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const orderRef = useRef(0);
  if (!active) orderRef.current = 0;
  else if (orderRef.current === 0) orderRef.current = ++nextEscapeOrder;
  const shouldIgnoreRef = useRef(options?.shouldIgnore);
  shouldIgnoreRef.current = options?.shouldIgnore;

  useEffect(() => {
    if (!active) return;
    const entry: EscapeEntry = {
      close: () => onCloseRef.current(),
      order: orderRef.current,
      shouldIgnore: (e) => shouldIgnoreRef.current?.(e) ?? false,
    };
    insertEscapeEntry(entry);
    syncDocumentListener();
    return () => {
      const idx = escapeStack.lastIndexOf(entry);
      if (idx !== -1) escapeStack.splice(idx, 1);
      syncDocumentListener();
    };
  }, [active]);
};
