import './index.css';

export interface SwatchRowOption {
  /** Stable id AND the CSS color/background value painted onto the swatch —
   *  unique per row. Ignored when `isNone` is set. */
  value: string;
  /** Accessible name — used for both `title` and `aria-label`. */
  label: string;
  /** Renders the diagonal "no color" slash instead of a solid fill. Use
   *  this instead of trying to paint `value` (e.g. `'transparent'`) as a
   *  real background. */
  isNone?: boolean;
}

interface Props {
  options: ReadonlyArray<SwatchRowOption>;
  /** Currently selected option's `value`. */
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for the row's own `role="group"` wrapper. Pass this
   *  whenever the row's purpose isn't already announced by a labelled
   *  ancestor panel. */
  ariaLabel?: string;
  /** `'menuitemradio'` (default) — each swatch is `role="menuitemradio"` +
   *  `aria-checked`, for rows living inside a `role="menu"` ancestor
   *  (DropdownShell/Popover panels, or a hand-rolled menu popover like
   *  EdgeStylePanel's). `'toggle'` — plain buttons with `aria-pressed`, for
   *  rows living inside a toolbar-shaped ancestor that isn't a menu. */
  ariaPattern?: 'menuitemradio' | 'toggle';
  className?: string;
}

/**
 * ui/SwatchRow — the blessed row of pick-a-color swatches. Consolidates the
 * TextColorPicker / FrameHeaderControls / ShapeNodeBody (fill + stroke) /
 * EdgeStylePanel (color) clusters onto one circular, token-bordered swatch
 * shape and one active-ring treatment (a `var(--surface)` + `var(--accent)`
 * double ring, lifted from EdgeStylePanel's own pre-migration CSS — the one
 * site among the four that already expressed "active" with tokens instead
 * of a literal rgba() box-shadow).
 *
 * Deliberately narrow: this owns ONLY the swatch buttons and their
 * single-select state. It does not own the surrounding menu/popover/panel
 * chrome (pair it with `DropdownShell`/`Popover`, or a caller's own panel —
 * see `EdgeStylePanel`, which keeps its hand-rolled chip+popover shell and
 * only swaps its color ROW onto this), and it does not accommodate a
 * trailing "clear" action that isn't itself one of `options` (see
 * `TextSelectionBubble`'s SKIP verdict in docs/ui-reuse-burndown.md).
 *
 * Every migrated call site's own ancestor (a DropdownShell panel, or the
 * caller's own panel wrapper) already swallows `mousedown`/`click`
 * propagation over its full surface, so this component does not add its
 * own `onMouseDown` handling — EXCEPT `onClick`, which always calls
 * `stopPropagation()` (two of the four pre-migration sites relied on this
 * at the swatch level specifically, to keep a color pick from also
 * reaching a canvas node's own click-to-select handler; the other two
 * already had it covered by an ancestor, where a second `stopPropagation`
 * call is a harmless no-op).
 *
 * The currently active swatch also carries `data-menu-autofocus="true"` —
 * the convention `useMenuKeyboardNav` (and `ui/Select`) already use to
 * focus the SELECTED item on menu open rather than the first one. This is
 * a deliberate, additive behavior upgrade for the three DropdownShell-hosted
 * sites (which previously had no such marker and so autofocused whichever
 * swatch happened to be first in the DOM); EdgeStylePanel already did this
 * itself pre-migration.
 */
export const SwatchRow = ({
  options,
  value,
  onChange,
  ariaLabel,
  ariaPattern = 'menuitemradio',
  className,
}: Props) => {
  const isMenu = ariaPattern === 'menuitemradio';
  const classes = ['ui-swatchrow', className].filter(Boolean).join(' ');

  return (
    <div className={classes} role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.value === value;
        const stateProps = isMenu
          ? { role: 'menuitemradio' as const, 'aria-checked': active }
          : { 'aria-pressed': active };
        return (
          <button
            type="button"
            key={option.value}
            className={
              'ui-swatchrow__swatch' +
              (option.isNone ? ' ui-swatchrow__swatch--none' : '') +
              (active ? ' ui-swatchrow__swatch--active' : '')
            }
            style={option.isNone ? undefined : { background: option.value }}
            title={option.label}
            aria-label={option.label}
            data-menu-autofocus={active ? 'true' : undefined}
            onClick={(e) => {
              e.stopPropagation();
              onChange(option.value);
            }}
            {...stateProps}
          />
        );
      })}
    </div>
  );
};
