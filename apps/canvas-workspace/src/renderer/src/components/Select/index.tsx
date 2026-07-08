import { useRef, useState } from 'react';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useMenuKeyboardNav } from '../../hooks/useMenuKeyboardNav';
import './index.css';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

interface Props {
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
 * Neutral, accessible dropdown that replaces the native `<select>` so the
 * open menu inherits the app's chrome instead of the OS popup. Mirrors the
 * `AgentTypeSelect` interaction model — closes on outside press (via
 * `useClickOutside`) or Escape, with ArrowUp/Down + Enter handled inside the
 * menu by `useMenuKeyboardNav`. Pass `className` to inherit a surrounding
 * form's metrics (e.g. `cfg-input` in the settings panels).
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
}: Props) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
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
        <span className={`ui-select__value${selected ? '' : ' ui-select__value--placeholder'}`}>
          {selected?.label ?? placeholder ?? ''}
        </span>
        <span className="ui-select__caret" aria-hidden="true">
          <CaretGlyph />
        </span>
      </button>

      {open && (
        <SelectMenu
          options={options}
          value={value}
          ariaLabel={ariaLabel}
          onPick={pick}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
};

const SelectMenu = ({
  options,
  value,
  ariaLabel,
  onPick,
  onClose,
}: {
  options: ReadonlyArray<SelectOption>;
  value: string;
  ariaLabel?: string;
  onPick: (value: string) => void;
  onClose: () => void;
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  useMenuKeyboardNav(menuRef, onClose);

  return (
    <div ref={menuRef} className="ui-select__menu" role="listbox" aria-label={ariaLabel}>
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
