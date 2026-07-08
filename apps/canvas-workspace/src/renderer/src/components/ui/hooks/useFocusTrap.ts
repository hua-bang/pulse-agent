import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Hand-rolled focus trap for the ui/ overlay shells (Modal, Drawer) — no new
 * dependency. While `active`:
 *  - on activation, remembers `document.activeElement` and moves focus into
 *    `containerRef` (its first focusable descendant, or the container
 *    itself via a temporary `tabindex="-1"` when it has none);
 *  - Tab / Shift+Tab cycle within the container's focusable descendants
 *    instead of escaping to the rest of the page;
 *  - on deactivate/unmount, restores focus to the element that held it
 *    before activation — only if that element is still connected to the
 *    document (it may have been removed while the overlay was open).
 */
export const useFocusTrap = (active: boolean, containerRef: RefObject<HTMLElement>): void => {
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return undefined;

    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const container = containerRef.current;
    const getFocusables = (): HTMLElement[] =>
      Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);

    const first = getFocusables()[0];
    if (first) {
      first.focus();
    } else if (container) {
      if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
      container.focus();
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const items = getFocusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const currentIndex = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey) {
        if (currentIndex <= 0) {
          event.preventDefault();
          items[items.length - 1].focus();
        }
      } else if (currentIndex === -1 || currentIndex === items.length - 1) {
        event.preventDefault();
        items[0].focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      const previous = previouslyFocusedRef.current;
      if (previous?.isConnected) previous.focus();
    };
  }, [active, containerRef]);
};
