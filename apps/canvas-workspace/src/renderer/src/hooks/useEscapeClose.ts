import { useEffect, useRef } from 'react';
import { isImeComposing } from '../utils/ime';

/**
 * Escape-closes a popover/menu while it's open. Listens on `document` in the
 * capture phase and stops propagation, so the press is consumed by the
 * topmost open popover instead of also reaching window-level shortcut
 * handlers (canvas deselect, drawer close, …). IME-composition Escapes are
 * ignored — those dismiss the candidate window, not the popover.
 */
export const useEscapeClose = (active: boolean, onClose: () => void) => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || isImeComposing(e)) return;
      e.stopPropagation();
      onCloseRef.current();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [active]);
};
