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
 * Hand-rolled focus management for ui/ overlay shells (Modal, Drawer) and
 * route-scoped dialogs. While `active`:
 *  - on activation, remembers `document.activeElement` and moves focus into
 *    `containerRef` (its first focusable descendant, or the container
 *    itself via a temporary `tabindex="-1"` when it has none). A descendant
 *    that already took focus on mount (`autoFocus`) keeps it;
 *  - Tab / Shift+Tab cycle within the container's focusable descendants
 *    unless `trap:false` keeps a parallel app region interactive;
 *  - on deactivate/unmount, restores focus to the element that held it
 *    before activation — only if that element is still connected to the
 *    document (it may have been removed while the overlay was open).
 */
export const useFocusTrap = (
  active: boolean,
  containerRef: RefObject<HTMLElement>,
  options: { trap?: boolean } = {},
): void => {
  const trap = options.trap ?? true;
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const wasActiveRef = useRef(false);
  // Read the outside focus during render: by the time the effect runs, an
  // `autoFocus` field inside the overlay has already taken it.
  if (active && !wasActiveRef.current) {
    previouslyFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasActiveRef.current = active;

  useEffect(() => {
    if (!active) return undefined;

    const container = containerRef.current;
    const getFocusables = (): HTMLElement[] =>
      Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);

    // An `autoFocus` descendant may already hold focus; keep it there.
    const first = getFocusables()[0];
    const focusedInside = container?.contains(document.activeElement) ?? false;
    if (!focusedInside && first) {
      first.focus();
    } else if (!focusedInside && container) {
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

    if (trap) document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      if (trap) document.removeEventListener('keydown', handleKeyDown, true);
      const previous = previouslyFocusedRef.current;
      if (previous?.isConnected) previous.focus();
    };
  }, [active, containerRef, trap]);
};
