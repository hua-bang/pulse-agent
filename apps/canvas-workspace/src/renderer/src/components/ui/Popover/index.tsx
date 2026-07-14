import { createPortal } from 'react-dom';
import { useEffect, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { useViewportClampedPosition } from '../../../hooks/useViewportClampedPosition';
import { useAnchorRectPosition } from '../../../hooks/useAnchorRectPosition';
import { useMenuKeyboardNav } from '../../../hooks/useMenuKeyboardNav';
import { useClickOutside } from '../../../hooks/useClickOutside';

// A stable "no anchor" ref so useAnchorRectPosition can be called
// UNCONDITIONALLY below (rules-of-hooks — Popover supports two anchoring
// modes off one component and must keep hook-call order identical across
// renders regardless of which mode a given instance uses). A fresh object
// literal here instead would change identity every render and thrash the
// hook's effect dependencies for no reason.
const NO_ANCHOR: RefObject<HTMLElement> = { current: null };

/** Why the popover closed itself. Mirrors `ui/DropdownShell`'s
 *  `DropdownCloseReason` — same precedent, same reason a caller might want
 *  to react differently: `'escape'` is a deliberate dismiss (safe to move
 *  focus back to the trigger), `'outside'` means the user's attention
 *  already moved elsewhere (don't yank focus back and fight that). Existing
 *  zero-arg `onClose` callbacks keep compiling and running unchanged —
 *  JS/TS callbacks are free to ignore extra arguments. */
type PopoverCloseReason = 'escape' | 'outside';

interface SharedProps {
  onClose: (reason?: PopoverCloseReason) => void;
  /** ARIA role on the root element. Defaults to `menu`. */
  role?: string;
  /** Class applied to the root positioned div (the element `style`
   *  left/top land on). Bring the surface/animation/`position: fixed`
   *  styling here — Popover only owns geometry, not appearance. */
  className?: string;
  /**
   * Whether opening the popover moves focus to its first focusable item.
   * Default `true` (menu behavior). Set `false` for combobox-style callers
   * that anchor a menu next to a live editor/filter `<input>` — keeping
   * focus in that input while the popover is open is the whole point (a
   * forced autofocus would yank focus out of it on every open). Passed
   * straight through to `useMenuKeyboardNav`'s own `autoFocus` option; the
   * Escape-close and arrow-key nav behaviors are unaffected either way.
   */
  autoFocus?: boolean;
  /** Accessible name for the panel, rendered as `aria-label`. A bare
   *  `role="menu"` announces as an unnamed menu — pass one whenever the
   *  menu's purpose isn't obvious from its items. */
  ariaLabel?: string;
  /** `id` rendered on the panel so a caller's own trigger button can point
   *  `aria-controls`/`aria-owns` at it. */
  panelId?: string;
  children: ReactNode;
}

interface PointAnchorProps extends SharedProps {
  /** Anchor x (viewport/screen px) — usually a click event's clientX. */
  x: number;
  /** Anchor y (viewport/screen px) — usually a click event's clientY. */
  y: number;
  anchorRef?: undefined;
}

interface RectAnchorProps extends SharedProps {
  /** Live element to position the panel relative to (its rect), instead of
   *  a one-shot x/y coordinate. Repositions on scroll/resize — see
   *  `useAnchorRectPosition`. */
  anchorRef: RefObject<HTMLElement>;
  /** Preferred side of the anchor; flips to the opposite side when there
   *  isn't room. Default 'bottom'. */
  placement?: 'top' | 'bottom';
  /** Which edge of the anchor the panel's matching edge aligns to. Default
   *  'start' (left edges aligned). */
  align?: 'start' | 'end';
  /** Gap between the anchor and the panel, px. Default 8. */
  gap?: number;
  /** Minimum distance kept from the viewport edge, px. Default 8. */
  viewportMargin?: number;
  x?: undefined;
  y?: undefined;
}

type Props = PointAnchorProps | RectAnchorProps;

/**
 * Popover — the blessed portal-to-`document.body` popup shell, extracted
 * verbatim from the canvas context-menu trio (NodeContextMenu / EdgeContextMenu
 * / LayerContextMenu). Owns all three dismissal/navigation behaviours:
 *
 *  - Escape + ArrowUp/ArrowDown/Home/End nav across the menu's buttons
 *    (`useMenuKeyboardNav`);
 *  - outside-press dismissal (`useClickOutside`, containment-aware — an
 *    inside press never self-closes).
 *
 * Two anchoring modes, chosen by which props a caller passes:
 *
 *  - **Point anchor** (`x`/`y`, the original/default shape): one-shot
 *    coordinates (e.g. a right-click), clamped inside the viewport once via
 *    `useViewportClampedPosition`. Existing callers are unaffected.
 *  - **Rect anchor** (`anchorRef`): positions relative to a LIVE element's
 *    rect and keeps reanchoring on scroll/resize via
 *    `useAnchorRectPosition` — for a trigger button whose position can
 *    change while the panel is open (e.g. `chat/ModelSwitcher`), which a
 *    one-shot x/y clamp cannot track. A press on `anchorRef` itself never
 *    counts as an outside press (the anchor structurally IS the trigger).
 *
 * `onClose` receives an optional `reason` (`'escape' | 'outside'`, omitted
 * for neither) — the same close-reason shape `ui/DropdownShell` already
 * exposes, for callers that want to restore focus to their trigger on a
 * deliberate Escape but not fight the user's attention on an outside press
 * (see `chat/ModelSwitcher`).
 *
 * Because Popover already wires those, callers MUST NOT also call
 * `useMenuKeyboardNav` / `useClickOutside` / `useEscapeClose` themselves,
 * nor hand-roll a document keydown/mousedown dismiss listener — doing so
 * double-fires. `className` lands on the root positioned `<div>` (the
 * element carrying `style={{ left, top }}`); put `position: fixed`, the
 * surface look, and any entrance animation there.
 *
 * Suppresses the native context-menu on right-click over the popover itself
 * (e.g. right-clicking an already-open menu) — some callers previously
 * hand-rolled this per-instance; Popover now owns it uniformly rather than
 * relying on an ancestor's own contextmenu handler, which not every caller
 * has (review finding, 2026-07-08: proven redundant for the canvas menus,
 * which sit under a preventDefault-ing ancestor, but LayerContextMenu's
 * Sidebar tree has no such ancestor).
 */
export const Popover = (props: Props) => {
  const { onClose, role = 'menu', className, autoFocus = true, ariaLabel, panelId, children } = props;

  // Resolve inputs for BOTH anchoring hooks up front so both can be called
  // unconditionally below (rules-of-hooks) regardless of which mode this
  // instance uses.
  let x = 0;
  let y = 0;
  let anchorRef: RefObject<HTMLElement> = NO_ANCHOR;
  let placement: 'top' | 'bottom' | undefined;
  let align: 'start' | 'end' | undefined;
  let gap: number | undefined;
  let viewportMargin: number | undefined;
  const rectAnchored = props.anchorRef !== undefined;
  if (props.anchorRef !== undefined) {
    anchorRef = props.anchorRef;
    placement = props.placement;
    align = props.align;
    gap = props.gap;
    viewportMargin = props.viewportMargin;
  } else {
    x = props.x;
    y = props.y;
  }

  const pointAnchor = useViewportClampedPosition<HTMLDivElement>(x, y);
  const rectAnchor = useAnchorRectPosition<HTMLDivElement>({
    anchorRef,
    placement,
    align,
    gap,
    viewportMargin,
    enabled: rectAnchored,
  });

  const ref = rectAnchored ? rectAnchor.ref : pointAnchor.ref;
  const style: CSSProperties = rectAnchored
    ? {
        left: rectAnchor.pos?.left ?? -9999,
        top: rectAnchor.pos?.top ?? -9999,
        visibility: rectAnchor.pos ? undefined : 'hidden',
      }
    : { left: pointAnchor.pos.left, top: pointAnchor.pos.top };

  const closeFromEscape = () => onClose('escape');
  const closeFromOutside = () => onClose('outside');

  useMenuKeyboardNav(ref, closeFromEscape, { autoFocus });
  // In rect-anchor mode, the anchor is structurally the caller's TRIGGER
  // (that's the whole point of anchoring to it) and stays mounted outside
  // the portaled panel's own DOM subtree. Without exempting it, a press on
  // the trigger while open would register as "outside" (closing) AND still
  // run the trigger's own click handler (commonly a toggle) in the same
  // click gesture — React 18 batches both updates, and a plain `onClose`
  // update followed by a functional toggle update resolves to STILL OPEN,
  // silently swallowing the user's close-by-retrigger click. Point-anchor
  // mode has no persistent trigger element to exempt (its callers open from
  // a transient event like a right-click), so this only applies here.
  useClickOutside(rectAnchored ? [ref, anchorRef] : ref, closeFromOutside);

  // Persistent Dock panes stay mounted and switch through `visibility` so
  // webviews and document scroll positions survive tab changes. A portaled
  // popover is outside that hidden subtree, so close it as soon as its anchor
  // becomes hidden instead of leaving a floating orphan over the next pane.
  useEffect(() => {
    if (!rectAnchored || !anchorRef.current || typeof MutationObserver === 'undefined') return;
    const anchor = anchorRef.current;
    let delayedCheck: ReturnType<typeof setTimeout> | null = null;
    const closeIfHidden = () => {
      if (!anchor.isConnected) {
        onClose('outside');
        return;
      }
      let current: HTMLElement | null = anchor;
      while (current) {
        const style = window.getComputedStyle(current);
        if (style.visibility === 'hidden' || style.display === 'none') {
          onClose('outside');
          return;
        }
        current = current.parentElement;
      }
    };
    const checkVisibility = () => {
      closeIfHidden();
      if (delayedCheck) clearTimeout(delayedCheck);
      // Some persistent panels delay `visibility:hidden` until their slide-out
      // transition completes. Recheck after that transition boundary.
      delayedCheck = setTimeout(closeIfHidden, 320);
    };
    const observer = new MutationObserver(checkVisibility);
    observer.observe(document.documentElement, {
      attributes: true,
      subtree: true,
      attributeFilter: ['class', 'style', 'data-expanded'],
    });
    checkVisibility();
    return () => {
      observer.disconnect();
      if (delayedCheck) clearTimeout(delayedCheck);
    };
  }, [anchorRef, onClose, rectAnchored]);

  return createPortal(
    <div
      ref={ref}
      id={panelId}
      role={role}
      aria-label={ariaLabel}
      className={className}
      style={style}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
};
