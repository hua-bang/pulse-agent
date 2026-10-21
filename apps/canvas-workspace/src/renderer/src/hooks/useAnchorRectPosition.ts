import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';

const VIEWPORT_MARGIN_PX = 8;
const GAP_PX = 8;

type Placement = 'top' | 'bottom';
type Align = 'start' | 'end';

interface Options {
  /** Live element the panel is positioned relative to (its rect, not a
   *  one-shot x/y coordinate — see `useViewportClampedPosition` for that). */
  anchorRef: RefObject<HTMLElement>;
  /** Preferred side of the anchor. Flips to the opposite side when the
   *  preferred side doesn't have enough viewport room. Default 'bottom'. */
  placement?: Placement;
  /** Which edge of the anchor the panel's matching edge lines up with.
   *  'start' = left edges aligned, 'end' = right edges aligned. Default
   *  'start'. */
  align?: Align;
  /** Gap between the anchor and the panel, px. Default 8. */
  gap?: number;
  /** Minimum distance kept from the viewport edge, px. Default 8 (matches
   *  `useViewportClampedPosition`'s own margin). */
  viewportMargin?: number;
  /** Set `false` to skip measuring/listening entirely — for callers that
   *  invoke this hook unconditionally alongside another positioning mode
   *  (see `ui/Popover`, which supports both x/y and rect anchoring off one
   *  component and must keep hook-call order stable either way). Default
   *  `true`. */
  enabled?: boolean;
  /** Match the panel to a composer-sized anchor, within viewport margins. */
  matchAnchorWidth?: boolean;
  /** Keep portaled suggestions hidden with retained or detached editors. */
  hideWhenAnchorHidden?: boolean;
}

/**
 * Positions a `position: fixed` panel relative to a LIVE element's rect (a
 * trigger button), re-measuring on window resize, ancestor scroll, and panel
 * resize — the capability `useViewportClampedPosition`'s one-shot x/y clamp
 * doesn't have.
 * Extracted from `models/ModelSwitcher`'s hand-rolled `updateMenuPosition`
 * (API-extension batch follow-up, see `docs/ui-reuse-burndown.md`).
 *
 * Tries the preferred `placement` first; if the panel doesn't fit on that
 * side within `viewportMargin`, flips to the opposite side and clamps
 * between the viewport edges. The cross-axis (`align`) is independently
 * clamped inside the viewport the same way.
 *
 * Listens on `scroll` in the CAPTURE phase — a scrollable ANCESTOR's own
 * 'scroll' event doesn't bubble up to `window`, only capture-phase listeners
 * registered on an ancestor (here, `window`) observe it during the event's
 * capture pass.
 *
 * `pos` is `null` until the panel has been measured once (its size isn't
 * known before it's mounted in the DOM) — render off-screen/hidden until
 * then, so the panel never flashes at (0,0) on first open.
 */
export const useAnchorRectPosition = <T extends HTMLElement>({
  anchorRef,
  placement = 'bottom',
  align = 'start',
  gap = GAP_PX,
  viewportMargin = VIEWPORT_MARGIN_PX,
  enabled = true,
  matchAnchorWidth = false,
  hideWhenAnchorHidden = false,
}: Options) => {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = ref.current;
    if (!anchor) {
      setPos(null);
      return;
    }
    const anchorRect = anchor.getBoundingClientRect();
    if (hideWhenAnchorHidden) {
      let visible = anchor.isConnected && anchorRect.width > 0 && anchorRect.height > 0;
      for (let element: HTMLElement | null = anchor; element; element = element.parentElement) {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden'
          || style.visibility === 'collapse' || style.opacity === '0'
          || element.hidden || element.inert || element.getAttribute('aria-hidden') === 'true') {
          visible = false;
        }
      }
      if (!visible) {
        setPos(null);
        return;
      }
    }
    if (matchAnchorWidth && panel) {
      panel.style.width = `${Math.min(anchorRect.width, Math.max(0, window.innerWidth - viewportMargin * 2))}px`;
    }
    const panelWidth = panel?.offsetWidth ?? 0;
    const panelHeight = panel?.offsetHeight ?? 0;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top: number;
    if (placement === 'top') {
      top = anchorRect.top - panelHeight - gap;
      if (top < viewportMargin) {
        const below = anchorRect.bottom + gap;
        top = Math.min(below, viewportHeight - panelHeight - viewportMargin);
        top = Math.max(top, viewportMargin);
      }
    } else {
      top = anchorRect.bottom + gap;
      if (top + panelHeight > viewportHeight - viewportMargin) {
        const above = anchorRect.top - panelHeight - gap;
        top = Math.max(above, viewportMargin);
        top = Math.min(top, viewportHeight - panelHeight - viewportMargin);
      }
    }

    let left = align === 'end' ? anchorRect.right - panelWidth : anchorRect.left;
    left = Math.min(left, viewportWidth - panelWidth - viewportMargin);
    left = Math.max(left, viewportMargin);

    setPos({ left, top });
  }, [anchorRef, placement, align, gap, viewportMargin, matchAnchorWidth, hideWhenAnchorHidden]);

  useLayoutEffect(() => {
    if (!enabled) return;
    reposition();
  }, [enabled, reposition]);

  useEffect(() => {
    if (!enabled) return undefined;
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [enabled, reposition]);

  useEffect(() => {
    if (!enabled || typeof ResizeObserver === 'undefined') return undefined;
    const panel = ref.current;
    if (!panel) return undefined;

    // A rect-anchored panel can change size while it stays open (for example,
    // filtering ModelSwitcher's long catalog down to two matches). Its old
    // top/left were calculated from the pre-filter dimensions, so without a
    // fresh measurement a top-placed panel visibly detaches from its trigger.
    const observer = new ResizeObserver(reposition);
    observer.observe(panel);
    if (matchAnchorWidth && anchorRef.current) observer.observe(anchorRef.current);
    return () => observer.disconnect();
  }, [enabled, reposition, anchorRef, matchAnchorWidth]);

  useEffect(() => {
    if (!enabled || !hideWhenAnchorHidden || typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(reposition);
    for (let element = anchorRef.current; element; element = element.parentElement) {
      observer.observe(element, {
        attributes: true, childList: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'inert', 'data-expanded'],
      });
    }
    window.addEventListener('transitionend', reposition, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('transitionend', reposition, true);
    };
  }, [anchorRef, enabled, hideWhenAnchorHidden, reposition]);

  return { ref, pos };
};
