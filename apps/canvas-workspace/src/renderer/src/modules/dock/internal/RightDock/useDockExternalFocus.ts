import { useEffect, type RefObject } from 'react';
import { FOCUS_OUTSIDE_DOCK_EVENT } from './dock-browser-commands';

/**
 * Remembers the most recent focus owner outside the dock so collapsing the
 * panel can hand keyboard control back to the canvas instead of losing it on
 * a detached dock control.
 */
export const useDockExternalFocus = (
  dockRef: RefObject<HTMLElement>,
  fallbackLauncherLabel: string,
): void => {
  useEffect(() => {
    let lastOutsideFocus: HTMLElement | null = null;
    let restoreFrame: number | null = null;
    const isDockOwned = (element: HTMLElement) => Boolean(
      dockRef.current?.contains(element)
      || element.closest('.context-menu--in-dock'),
    );
    const isStableOutsideOwner = (element: HTMLElement) => (
      element !== document.body
      && element !== document.documentElement
      && !isDockOwned(element)
    );
    const rememberOutsideFocus = (event: FocusEvent) => {
      const element = event.target;
      if (element instanceof HTMLElement && isStableOutsideOwner(element)) {
        lastOutsideFocus = element;
      }
    };
    const restoreOutsideFocus = () => {
      if (restoreFrame !== null) cancelAnimationFrame(restoreFrame);
      restoreFrame = requestAnimationFrame(() => {
        restoreFrame = null;
        if (lastOutsideFocus?.isConnected && isStableOutsideOwner(lastOutsideFocus)) {
          lastOutsideFocus.focus();
          if (document.activeElement === lastOutsideFocus) return;
        }
        const launcher = [...document.querySelectorAll<HTMLButtonElement>('button')]
          .find((button) => (
            !isDockOwned(button)
            && button.getAttribute('aria-label') === fallbackLauncherLabel
          ));
        launcher?.focus();
      });
    };
    const active = document.activeElement;
    if (active instanceof HTMLElement && isStableOutsideOwner(active)) {
      lastOutsideFocus = active;
    }
    window.addEventListener('focusin', rememberOutsideFocus);
    window.addEventListener(FOCUS_OUTSIDE_DOCK_EVENT, restoreOutsideFocus);
    return () => {
      window.removeEventListener('focusin', rememberOutsideFocus);
      window.removeEventListener(FOCUS_OUTSIDE_DOCK_EVENT, restoreOutsideFocus);
      if (restoreFrame !== null) cancelAnimationFrame(restoreFrame);
    };
  }, [dockRef, fallbackLauncherLabel]);
};
