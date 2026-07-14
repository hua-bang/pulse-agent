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
}

/**
 * Positions a `position: fixed` panel relative to a LIVE element's rect (a
 * trigger button), re-measuring on window resize and ancestor scroll — the
 * capability `useViewportClampedPosition`'s one-shot x/y clamp doesn't have.
 * Extracted from `chat/ModelSwitcher`'s hand-rolled `updateMenuPosition`
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
}: Options) => {
  const ref = useRef<T>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = ref.current;
    if (!anchor) return;
    const anchorRect = anchor.getBoundingClientRect();
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
  }, [anchorRef, placement, align, gap, viewportMargin]);

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

  return { ref, pos };
};
