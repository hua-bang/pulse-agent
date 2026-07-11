import { useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useMenuKeyboardNav } from '../../../hooks/useMenuKeyboardNav';
import './index.css';

type Placement = 'top' | 'bottom';
type Align = 'start' | 'center' | 'end';
/**
 * Why the panel closed itself (dismissal paths the shell owns). Omitted for
 * open transitions and for closes the shell can't attribute to one of these
 * two paths (trigger re-click, an item pick via the render-prop `close()`) —
 * those keep calling `onOpenChange(open)` with no second argument, so
 * existing single-arg callers are unaffected. `'escape'` is the only reason
 * that should ever move focus: `'outside'` means the user's attention is
 * already elsewhere (e.g. clicked another control), so yanking focus back to
 * the trigger would fight that.
 */
type DropdownCloseReason = 'escape' | 'outside';

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
  /** Accessible name for the panel — a bare role="menu" announces as an
   *  unnamed menu, so pass one whenever the menu's purpose isn't obvious
   *  from its items. */
  ariaLabel?: string;
  /** `id` rendered on the panel so the caller's trigger can point
   *  `aria-controls` at it (the trigger is caller-rendered, so the shell
   *  can't wire the linkage itself). */
  panelId?: string;
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
  /**
   * Fires on every open/close transition. `reason` is only set for the two
   * dismissal paths a caller might treat differently — `'escape'` (restore
   * focus to the trigger) vs `'outside'` (don't: the user already moved
   * focus/attention elsewhere by clicking outside). It is omitted (single-arg
   * call, same as before this option existed) for opening, trigger-toggle
   * closes, and item-pick closes via the render-prop `close()`.
   */
  onOpenChange?: (open: boolean, reason?: DropdownCloseReason) => void;
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
  ariaLabel,
  panelId,
  className,
  panelClassName,
  children,
  onOpenChange,
  onPanelMouseDown,
}: Props) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const applyOpen = (next: boolean, reason?: DropdownCloseReason) => {
    setOpen(next);
    if (reason) onOpenChange?.(next, reason);
    else onOpenChange?.(next);
  };
  const toggle = () => applyOpen(!open);
  // Exposed to children via the render-prop — an item pick dismissing the
  // panel isn't a reason a caller needs to react to differently.
  const close = () => applyOpen(false);
  const closeFromOutside = () => applyOpen(false, 'outside');
  const closeFromEscape = () => applyOpen(false, 'escape');

  useClickOutside(rootRef, closeFromOutside, open);
  useMenuKeyboardNav(panelRef, closeFromEscape, open);

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
          aria-label={ariaLabel}
          id={panelId}
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
