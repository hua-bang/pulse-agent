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
 */
export const Popover = ({ x, y, onClose, role = 'menu', className, children }: Props) => {
  const { ref, pos } = useViewportClampedPosition<HTMLDivElement>(x, y);
  useMenuKeyboardNav(ref, onClose);
  useClickOutside(ref, onClose);

  return createPortal(
    <div
      ref={ref}
      role={role}
      className={className}
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
};
