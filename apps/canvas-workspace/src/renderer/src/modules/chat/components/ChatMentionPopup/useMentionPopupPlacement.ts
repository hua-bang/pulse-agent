import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';
import { useAnchorRectPosition } from '../../../../hooks/useAnchorRectPosition';

const VIEWPORT_MARGIN = 8;

/** Composer-only sizing and visibility stay with the on-demand mention UI. */
export const useMentionPopupPlacement = (anchorRef: RefObject<HTMLElement>) => {
  const { ref, pos, reposition } = useAnchorRectPosition<HTMLDivElement>({
    anchorRef, placement: 'top', gap: 4, viewportMargin: VIEWPORT_MARGIN,
  });
  const [visible, setVisible] = useState(false);
  const syncAnchor = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = ref.current;
    if (!anchor || !panel) {
      setVisible(false);
      return;
    }
    const rect = anchor.getBoundingClientRect();
    let nextVisible = anchor.isConnected && rect.width > 0 && rect.height > 0;
    for (let element: HTMLElement | null = anchor; element; element = element.parentElement) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden'
        || style.visibility === 'collapse' || style.opacity === '0'
        || element.hidden || element.inert || element.getAttribute('aria-hidden') === 'true') {
        nextVisible = false;
      }
    }
    setVisible(nextVisible);
    if (!nextVisible) return;
    panel.style.width = `${Math.min(rect.width, Math.max(0, window.innerWidth - VIEWPORT_MARGIN * 2))}px`;
    reposition();
  }, [anchorRef, ref, reposition]);

  useLayoutEffect(() => {
    syncAnchor();
    const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(syncAnchor);
    if (anchorRef.current) resizeObserver?.observe(anchorRef.current);
    const observer = typeof MutationObserver === 'undefined' ? null : new MutationObserver(syncAnchor);
    for (let element = anchorRef.current; element; element = element.parentElement) {
      observer?.observe(element, {
        attributes: true, childList: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'inert', 'data-expanded'],
      });
    }
    window.addEventListener('resize', syncAnchor);
    window.addEventListener('transitionend', syncAnchor, true);
    return () => {
      resizeObserver?.disconnect();
      observer?.disconnect();
      window.removeEventListener('resize', syncAnchor);
      window.removeEventListener('transitionend', syncAnchor, true);
    };
  }, [anchorRef, syncAnchor]);

  return { ref, pos, visible };
};
