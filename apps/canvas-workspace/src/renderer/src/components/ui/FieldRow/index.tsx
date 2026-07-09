import type { ReactNode } from 'react';
import './index.css';

interface Props {
  label?: ReactNode;
  hint?: ReactNode;
  /** Extra class merged onto the root wrapper. */
  className?: string;
  children: ReactNode;
}

/**
 * ui/FieldRow — generic "label above, control, hint below" layout shell.
 * Consolidates the `*-field` cluster (`language-section-field`,
 * `workspace-settings-field`, `cfg-field`, …) that repeats a
 * `display:flex; flex-direction:column; gap` wrapper around a labelled
 * control.
 *
 * Relationship to `ui/TextField`: TextField remains the blessed piece for
 * TEXT controls — it owns the `<input>`/`<textarea>` itself, pairs the
 * label with the control via a native `<label>`, and wires
 * `aria-describedby` for the hint. FieldRow is the generic wrapper for any
 * OTHER control (a `Select`, a checkbox, a button row, a custom widget) that
 * needs the same label/hint shape but doesn't have a single input element to
 * own. Do not refactor TextField onto FieldRow — they solve different
 * problems (owned text input vs. arbitrary children).
 */
export const FieldRow = ({ label, hint, className, children }: Props) => {
  const classes = ['ui-fieldrow', className].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      {label != null && <span className="ui-fieldrow__label">{label}</span>}
      {children}
      {hint != null && <span className="ui-fieldrow__hint">{hint}</span>}
    </div>
  );
};
