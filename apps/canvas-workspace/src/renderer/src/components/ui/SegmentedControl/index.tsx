import type { ReactNode } from 'react';
import './index.css';

export interface SegmentedControlOption {
  id: string;
  label: ReactNode;
  /** Optional per-option tooltip (native `title`); not every caller needs one. */
  title?: string;
}

interface Props {
  options: ReadonlyArray<SegmentedControlOption>;
  value: string;
  onChange: (id: string) => void;
  /** 'radio' = `role="radiogroup"` > `role="radio"`/`aria-checked` (default,
   *  for a settings-style "pick one" control). 'tab' = `role="tablist"` >
   *  `role="tab"`/`aria-selected` (for view switchers whose content is a
   *  visible panel). */
  ariaPattern?: 'radio' | 'tab';
  ariaLabel?: string;
  className?: string;
}

/**
 * ui/SegmentedControl — the blessed "pick one of N" control. Consolidates
 * the hand-rolled tab-strip/radio-strip cluster (AgentTeamFrame alone had
 * four, one missing `role="tab"`/`aria-selected` entirely — a real a11y
 * gap this component closes by construction) behind one ARIA-correct
 * implementation. Pick `ariaPattern="tab"` when the options switch a
 * visible content panel (view/tab semantics); the default `"radio"` fits a
 * settings-style exclusive choice that doesn't swap a panel.
 */
export const SegmentedControl = ({
  options,
  value,
  onChange,
  ariaPattern = 'radio',
  ariaLabel,
  className,
}: Props) => {
  const isTab = ariaPattern === 'tab';
  const groupRole = isTab ? 'tablist' : 'radiogroup';
  const optionRole = isTab ? 'tab' : 'radio';
  const classes = ['ui-segmented', className].filter(Boolean).join(' ');

  return (
    <div className={classes} role={groupRole} aria-label={ariaLabel}>
      {options.map((option) => {
        const active = option.id === value;
        const optionProps = isTab ? { 'aria-selected': active } : { 'aria-checked': active };
        return (
          <button
            key={option.id}
            type="button"
            role={optionRole}
            className={`ui-segmented__option${active ? ' ui-segmented__option--active' : ''}`}
            title={option.title}
            onClick={() => onChange(option.id)}
            {...optionProps}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};
