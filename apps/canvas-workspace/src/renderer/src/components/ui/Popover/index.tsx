import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { useViewportClampedPosition } from '../../../hooks/useViewportClampedPosition';
import { useMenuKeyboardNav } from '../../../hooks/useMenuKeyboardNav';
import { useClickOutside } from '../../../hooks/useClickOutside';

interface Props {
  /** Anchor x (viewport/screen px) — usually a click event's clientX. */
  x: number;
  /** Anchor y (viewport/screen px) — usually a click event's clientY. */
  y: number;
  onClose: () => void;
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
  children: ReactNode;
}

/**
 * Popover — the blessed point-anchored popover shell, extracted verbatim
 * from the canvas context-menu trio (NodeContextMenu / EdgeContextMenu /
 * LayerContextMenu). Clamps the anchor inside the viewport
 * (`useViewportClampedPosition`), portals to `document.body`, and OWNS all
 * three dismissal/navigation behaviours:
 *
 *  - Escape + ArrowUp/ArrowDown/Home/End nav across the menu's buttons
 *    (`useMenuKeyboardNav`);
 *  - outside-press dismissal (`useClickOutside`, containment-aware — an
 *    inside press never self-closes).
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
export const Popover = ({ x, y, onClose, role = 'menu', className, autoFocus = true, children }: Props) => {
  const { ref, pos } = useViewportClampedPosition<HTMLDivElement>(x, y);
  useMenuKeyboardNav(ref, onClose, { autoFocus });
  useClickOutside(ref, onClose);

  return createPortal(
    <div
      ref={ref}
      role={role}
      className={className}
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
};
