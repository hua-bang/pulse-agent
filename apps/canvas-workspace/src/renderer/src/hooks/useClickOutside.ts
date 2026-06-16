import { useEffect, useRef, type RefObject } from 'react';

type MaybeRefs = RefObject<HTMLElement> | ReadonlyArray<RefObject<HTMLElement>>;

/**
 * Dismiss-on-outside-press for overlays (menus, dropdowns, pickers, popovers).
 *
 * Consolidates the dozen ad-hoc `addEventListener('mousedown', …)` +
 * `ref.contains(target)` blocks that were scattered across the canvas
 * overlays, each subtly different (window vs document, click vs mousedown,
 * capture phase, `setTimeout` defers). One canonical behavior:
 *
 *  - listens on `document` for `mousedown` in the CAPTURE phase, so an inner
 *    `stopPropagation` can't suppress it and the press is evaluated before
 *    focus/click side effects run;
 *  - calls `onOutside` only when the press lands outside EVERY ref — pass the
 *    trigger AND the popover for trigger/popover pairs so clicking the trigger
 *    doesn't count as "outside";
 *  - gated by `active`, so it only listens while the overlay is open;
 *  - attaches inside an effect, which React runs after the event that opened
 *    the overlay — so the opening press never dismisses it (no `setTimeout`
 *    hack needed).
 */
export const useClickOutside = (
  refs: MaybeRefs,
  onOutside: () => void,
  active = true,
): void => {
  const onOutsideRef = useRef(onOutside);
  onOutsideRef.current = onOutside;

  // Callers commonly pass a fresh array/ref literal each render. Keep the live
  // list in a ref so the listener effect depends only on `active` and isn't
  // re-subscribed on every render.
  const refsRef = useRef<ReadonlyArray<RefObject<HTMLElement>>>([]);
  refsRef.current = Array.isArray(refs) ? refs : [refs as RefObject<HTMLElement>];

  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      for (const ref of refsRef.current) {
        if (ref.current?.contains(target)) return;
      }
      onOutsideRef.current();
    };
    document.addEventListener('mousedown', handler, true);
    return () => document.removeEventListener('mousedown', handler, true);
  }, [active]);
};
