import { useEffect, useRef } from 'react';
import { isImeComposing } from '../utils/ime';

type EscapeEntry = {
  close: () => void;
};

const escapeStack: EscapeEntry[] = [];
let listenerAttached = false;

const handleDocumentEscape = (e: KeyboardEvent) => {
  if (e.key !== 'Escape' || isImeComposing(e) || escapeStack.length === 0) return;
  const top = escapeStack[escapeStack.length - 1];
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
 */
export const useEscapeClose = (active: boolean, onClose: () => void) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const entry: EscapeEntry = {
      close: () => onCloseRef.current(),
    };
    escapeStack.push(entry);
    syncDocumentListener();
    return () => {
      const idx = escapeStack.lastIndexOf(entry);
      if (idx !== -1) escapeStack.splice(idx, 1);
      syncDocumentListener();
    };
  }, [active]);
};
