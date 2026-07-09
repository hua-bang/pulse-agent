import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useMenuKeyboardNav } from '../../../hooks/useMenuKeyboardNav';
import './index.css';

type Placement = 'top' | 'bottom';
type Align = 'start' | 'center' | 'end';

interface Props {
  /** Caller renders its own trigger button(s); receives the live open state
   *  and a stable `toggle` to wire onto a click handler. */
  trigger: (args: { open: boolean; toggle: () => void }) => ReactNode;
  /** Where the panel unfolds relative to the trigger. Default 'bottom'. */
  placement?: Placement;
  /** Panel edge alignment against the trigger. Default 'start'. */
  align?: Align;
  /** ARIA role on the panel. Default 'menu'. */
  role?: string;
  /** Extra class on the ROOT wrapper (the `position: relative` element). */
  className?: string;
  /** Extra class on the anchored panel. */
  panelClassName?: string;
  /**
   * Panel content, rendered only while open. Static `ReactNode` is enough
   * for read-only panels; pass a function to get a stable `close()` for
   * "pick an item, then dismiss" menus (mirrors `trigger`'s render-prop
   * shape) — DropdownShell owns the open state internally, so content
   * defined outside the component has no other way to close it.
   */
  children: ReactNode | ((args: { open: boolean; close: () => void }) => ReactNode);
  onOpenChange?: (open: boolean) => void;
  /**
   * Extra mousedown handling on the panel, on top of the built-in
   * stopPropagation (e.g. `preventDefault` to keep an editor focused while
   * picking — see TextColorPicker). Runs before the built-in guard.
   */
  onPanelMouseDown?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

/**
 * ui/DropdownShell — the blessed TRIGGER-ANCHORED dropdown shell. Extracted
 * from the shape-tool-split / text-color-picker / frame-color-picker family:
 * local `open` state + a wrapper ref + a conditional `role="menu"` panel,
 * dismissed by `useClickOutside` (outside press) and `useMenuKeyboardNav`
 * (Escape + ArrowUp/Down/Home/End across the panel's buttons).
 *
 * Division of labor with `ui/Popover`: Popover is the POINT-anchored shell
 * (an x/y coordinate, e.g. a right-click) — it portals to `document.body`
 * and clamps to the viewport. DropdownShell is TRIGGER-anchored — it stays
 * in-flow next to the button that opened it (`position: relative` root +
 * `position: absolute` panel) and never portals; that's Popover's job when
 * a caller needs to escape a clipping ancestor.
 *
 * DropdownShell already owns click-outside / Escape / arrow-nav — callers
 * MUST NOT also call `useClickOutside`, `useMenuKeyboardNav`, or
 * `useEscapeClose` themselves, and must not hand-roll a dismiss listener;
 * doing so double-fires.
 *
 * The root wrapper carries `ui-dropdown--open` while the panel is open, so a
 * caller's own `className` can key off it (e.g. keeping a hover-revealed
 * trigger visible while its panel is open — see FrameColorPicker).
 *
 * The panel swallows `mousedown` (stopPropagation) over its ENTIRE surface —
 * padding and gaps included — so pressing inside an open dropdown can never
 * leak into canvas selection / node-drag handlers. Every pre-migration
 * wrapper carried this guard; a review caught that per-button relocation
 * silently dropped the padding coverage, hence it lives in the shell now.
 * Callers needing more (e.g. `preventDefault`) add it via `onPanelMouseDown`.
 */
export const DropdownShell = ({
  trigger,
  placement = 'bottom',
  align = 'start',
  role = 'menu',
  className,
  panelClassName,
  children,
  onOpenChange,
  onPanelMouseDown,
}: Props) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const applyOpen = (next: boolean) => {
    setOpen(next);
    onOpenChange?.(next);
  };
  const toggle = () => applyOpen(!open);
  const close = () => applyOpen(false);

  useClickOutside(rootRef, close, open);
  useMenuKeyboardNav(panelRef, close, open);

  const rootClass = ['ui-dropdown', open && 'ui-dropdown--open', className].filter(Boolean).join(' ');
  const panelClass = [
    'ui-dropdown__panel',
    `ui-dropdown--${placement}`,
    `ui-dropdown--align-${align}`,
    panelClassName,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={rootRef} className={rootClass}>
      {trigger({ open, toggle })}
      {open && (
        <div
          ref={panelRef}
          className={panelClass}
          role={role}
          onMouseDown={(event) => {
            onPanelMouseDown?.(event);
            event.stopPropagation();
          }}
        >
          {typeof children === 'function' ? children({ open, close }) : children}
        </div>
      )}
    </div>
  );
};
