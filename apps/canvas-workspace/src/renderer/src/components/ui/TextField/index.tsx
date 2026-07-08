import {
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import './index.css';

interface CommonProps {
  /** Field label rendered above the control. Caller supplies i18n copy. */
  label?: ReactNode;
  /** Helper text rendered below the control. Caller supplies i18n copy. */
  hint?: ReactNode;
}

type InputFieldProps = CommonProps & {
  multiline?: false;
} & InputHTMLAttributes<HTMLInputElement>;

type TextAreaFieldProps = CommonProps & {
  multiline: true;
} & TextareaHTMLAttributes<HTMLTextAreaElement>;

type Props = InputFieldProps | TextAreaFieldProps;

/**
 * ui/TextField — the blessed labelled text control. Consolidates the
 * `cfg-field` / `cfg-input` / `cfg-textarea` cluster (label + field + hint)
 * into one component; `multiline` switches the control between a single-line
 * input and a multi-line textarea. Standard input/textarea attributes pass
 * through (value/onChange/placeholder/disabled/type/rows…); `className` merges
 * onto the control so callers can inherit a surrounding form's metrics. Label
 * and hint copy come from callers — the component holds no hardcoded strings.
 */
export const TextField = ({ label, hint, className, multiline, ...rest }: Props) => {
  const controlClass = ['ui-textfield__control', className].filter(Boolean).join(' ');
  return (
    <label className="ui-textfield">
      {label != null && <span className="ui-textfield__label">{label}</span>}
      {multiline ? (
        <textarea className={controlClass} {...(rest as TextareaHTMLAttributes<HTMLTextAreaElement>)} />
      ) : (
        <input className={controlClass} {...(rest as InputHTMLAttributes<HTMLInputElement>)} />
      )}
      {hint != null && <span className="ui-textfield__hint">{hint}</span>}
    </label>
  );
};
