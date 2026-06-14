import { useEffect, useRef, useState } from 'react';
import { AgentIcon } from '../AgentNodeBody/AgentIcon';
import type { AgentDef } from '../../config/agentRegistry';

interface AgentTypeSelectProps {
  value: string;
  options: AgentDef[];
  ariaLabel?: string;
  disabled?: boolean;
  onChange: (id: string) => void;
}

const CaretGlyph = () => (
  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const CheckGlyph = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/**
 * Coding-agent picker used in the Agent Team plan review. Replaces the native
 * `<select>` so each option can carry its brand mark (`AgentIcon`). Closes on
 * outside click or Escape; stops propagation so interacting with it never
 * selects the surrounding agent card.
 */
export const AgentTypeSelect = ({ value, options, ariaLabel, disabled, onChange }: AgentTypeSelectProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((opt) => opt.id === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const pick = (id: string) => {
    setOpen(false);
    if (id !== value) onChange(id);
  };

  return (
    <div
      ref={rootRef}
      className={`agent-type-select${open ? ' agent-type-select--open' : ''}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <button
        type="button"
        className="agent-type-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <span className="agent-type-select__logo">
          <AgentIcon id={selected?.id ?? 'claude-code'} size={14} />
        </span>
        <span className="agent-type-select__value">{selected?.label ?? 'Coding agent'}</span>
        <span className="agent-type-select__caret">
          <CaretGlyph />
        </span>
      </button>

      {open && (
        <div className="agent-type-select__menu" role="listbox" aria-label={ariaLabel}>
          {options.map((opt) => {
            const isActive = opt.id === value;
            return (
              <button
                key={opt.id}
                type="button"
                role="option"
                aria-selected={isActive}
                className={`agent-type-select__option${isActive ? ' agent-type-select__option--active' : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  pick(opt.id);
                }}
              >
                <span className="agent-type-select__logo">
                  <AgentIcon id={opt.id} size={14} />
                </span>
                <span className="agent-type-select__option-copy">
                  <span className="agent-type-select__option-label">{opt.label}</span>
                  <span className="agent-type-select__option-desc">{opt.description}</span>
                </span>
                {isActive && (
                  <span className="agent-type-select__check">
                    <CheckGlyph />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
