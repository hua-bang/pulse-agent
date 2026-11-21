import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE_SELECTOR = [
  'a[href]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
  'input:not([disabled]):not([tabindex="-1"])',
  'select:not([disabled]):not([tabindex="-1"])',
  'textarea:not([disabled]):not([tabindex="-1"])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

type TrapEntry = {
  handleKeyDown: (event: KeyboardEvent) => void;
};

const trapStack: TrapEntry[] = [];
let trapListenerAttached = false;

const handleDocumentTab = (event: KeyboardEvent): void => {
  if (event.key !== 'Tab' || trapStack.length === 0) return;
  const top = trapStack[trapStack.length - 1];
  top.handleKeyDown(event);
};

const syncTrapListener = (): void => {
  if (trapStack.length > 0 && !trapListenerAttached) {
    document.addEventListener('keydown', handleDocumentTab, true);
    trapListenerAttached = true;
  } else if (trapStack.length === 0 && trapListenerAttached) {
    document.removeEventListener('keydown', handleDocumentTab, true);
    trapListenerAttached = false;
  }
};

const isFocusableVisible = (el: HTMLElement): boolean => {
  if (el.closest('[hidden], [inert]')) return false;
  if (typeof window.getComputedStyle === 'function') {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
  }
  return true;
};

/**
 * Hand-rolled focus management for ui/ overlay shells (Modal, Drawer) and
 * route-scoped dialogs. While `active`:
 *  - on activation, remembers `document.activeElement` and moves focus into
 *    `containerRef` (its first focusable descendant, or the container
 *    itself via a temporary `tabindex="-1"` when it has none). A descendant
 *    that already took focus on mount (`autoFocus`) keeps it;
 *  - Tab / Shift+Tab cycle within the topmost trapped container's visible
 *    focusable descendants (LIFO stack, matching `useEscapeClose`) unless
 *    `trap:false` keeps a parallel app region interactive;
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
      Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []).filter(
        isFocusableVisible,
      );

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

    const entry: TrapEntry = { handleKeyDown };
    if (trap) {
      trapStack.push(entry);
      syncTrapListener();
    }

    return () => {
      if (trap) {
        const idx = trapStack.lastIndexOf(entry);
        if (idx !== -1) trapStack.splice(idx, 1);
        syncTrapListener();
      }
      const previous = previouslyFocusedRef.current;
      if (previous?.isConnected) previous.focus();
    };
  }, [active, containerRef, trap]);
};
