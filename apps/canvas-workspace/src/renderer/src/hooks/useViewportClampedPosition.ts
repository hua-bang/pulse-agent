import { useLayoutEffect, useRef, useState } from 'react';

const VIEWPORT_MARGIN_PX = 8;

/**
 * Keeps a fixed-position popup (context menu, slash menu, …) fully inside
 * the viewport. The element first renders at the requested anchor, then a
 * layout effect measures it and pulls it back from the right/bottom edges
 * before paint — so opening a menu near a window edge never cuts items off.
 *
 * Measures `offsetWidth/offsetHeight` (layout size) rather than the bounding
 * rect so entry animations that translate/scale don't skew the clamp.
 */
export const useViewportClampedPosition = <T extends HTMLElement>(
  x: number,
  y: number,
) => {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      setPos({ left: x, top: y });
      return;
    }
    const maxLeft = window.innerWidth - el.offsetWidth - VIEWPORT_MARGIN_PX;
    const maxTop = window.innerHeight - el.offsetHeight - VIEWPORT_MARGIN_PX;
    setPos({
      left: Math.max(VIEWPORT_MARGIN_PX, Math.min(x, maxLeft)),
      top: Math.max(VIEWPORT_MARGIN_PX, Math.min(y, maxTop)),
    });
  }, [x, y]);

  return { ref, pos };
};
