import { useId, useRef, useState, type ReactNode } from 'react';
import { useClickOutside } from '../../../hooks/useClickOutside';
import { useMenuKeyboardNav } from '../../../hooks/useMenuKeyboardNav';
import './index.css';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  /** Optional leading mark rendered in the trigger + option row (e.g. a brand icon). */
  icon?: ReactNode;
}

/** Menu opens below the trigger by default; 'top' opens upward for triggers
 * near the bottom of a clipped container. */
type MenuPlacement = 'bottom' | 'top';

interface SelectProps {
  value: string;
  options: ReadonlyArray<SelectOption>;
  onChange: (value: string) => void;
  id?: string;
  ariaLabel?: string;
  /** Extra class on the root, e.g. to match a surrounding form's metrics. */
  className?: string;
  disabled?: boolean;
  /** Shown on the trigger when `value` matches no option. */
  placeholder?: string;
  /** Where the open menu unfolds relative to the trigger. Defaults to 'bottom'. */
  menuPlacement?: MenuPlacement;
}

const CaretGlyph = () => (
  <svg width="10" height="6" viewBox="0 0 10 6" fill="none" aria-hidden="true">
    <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CheckGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * ui/Select — the blessed dropdown that replaces the native `<select>` so the
 * open menu inherits the app's chrome instead of the OS popup. Closes on
 * outside press (via `useClickOutside`) or Escape, with ArrowUp/Down + Enter
 * handled inside the menu by `useMenuKeyboardNav`. The trigger's
 * `aria-controls` points at the listbox id — derived from the `id` prop when
 * given (`${id}-listbox`), otherwise a `useId()`-generated id. Pass
 * `className` to inherit a surrounding form's metrics (e.g. `cfg-input` in
 * the settings panels; it lands on the root wrapper div, not the trigger),
 * `icon` on options to carry a brand mark, and `menuPlacement="top"` when the
 * trigger sits near the bottom of a clipped container.
 */
export const Select = ({
  value,
  options,
  onChange,
  id,
  ariaLabel,
  className,
  disabled,
  placeholder,
  menuPlacement = 'bottom',
}: SelectProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const autoId = useId();
  const listboxId = `${id ?? autoId}-listbox`;
  const selected = options.find((opt) => opt.value === value);

  useClickOutside(rootRef, () => setOpen(false), open);

  const pick = (next: string) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };

  return (
    <div ref={rootRef} className={`ui-select${open ? ' ui-select--open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        id={id}
        className="ui-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
      >
        {selected?.icon && <span className="ui-select__icon" aria-hidden="true">{selected.icon}</span>}
        <span className={`ui-select__value${selected ? '' : ' ui-select__value--placeholder'}`}>
          {selected?.label ?? placeholder ?? ''}
        </span>
        <span className="ui-select__caret" aria-hidden="true">
          <CaretGlyph />
        </span>
      </button>

      {open && (
        <SelectMenu
          id={listboxId}
          options={options}
          value={value}
          ariaLabel={ariaLabel}
          placement={menuPlacement}
          onPick={pick}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
};

const SelectMenu = ({
  id,
  options,
  value,
  ariaLabel,
  placement,
  onPick,
  onClose,
}: {
  id: string;
  options: ReadonlyArray<SelectOption>;
  value: string;
  ariaLabel?: string;
  placement: MenuPlacement;
  onPick: (value: string) => void;
  onClose: () => void;
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuKeyboardNav(menuRef, onClose);

  return (
    <div
      ref={menuRef}
      id={id}
      className={`ui-select__menu${placement === 'top' ? ' ui-select__menu--top' : ''}`}
      role="listbox"
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const isActive = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="option"
            aria-selected={isActive}
            data-menu-autofocus={isActive ? 'true' : undefined}
            disabled={opt.disabled}
            className={`ui-select__option${isActive ? ' ui-select__option--active' : ''}`}
            onClick={() => onPick(opt.value)}
          >
            {opt.icon && <span className="ui-select__icon" aria-hidden="true">{opt.icon}</span>}
            <span className="ui-select__option-copy">
              <span className="ui-select__option-label">{opt.label}</span>
              {opt.description && (
                <span className="ui-select__option-desc">{opt.description}</span>
              )}
            </span>
            {isActive && (
              <span className="ui-select__check" aria-hidden="true">
                <CheckGlyph />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};
