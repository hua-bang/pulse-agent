import { useEffect, useRef } from 'react';
import { isImeComposing } from '../utils/ime';

/**
 * Escape leaves a full page (a drill-down or the settings page) the way its
 * own Back/Close control does. Bubble phase and target-gated, unlike
 * `useEscapeClose`: an open picker (capture-phase `useEscapeClose`), an
 * Escape another handler already used, and any text or contenteditable field
 * keep their own Escape. Mount it only while the page is shown.
 */
export const usePageEscape = (enabled: boolean, onBack: () => void) => {
  const onBackRef = useRef(onBack);
  onBackRef.current = onBack;

  useEffect(() => {
    if (!enabled) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isImeComposing(event)) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable) return;
      onBackRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled]);
};
