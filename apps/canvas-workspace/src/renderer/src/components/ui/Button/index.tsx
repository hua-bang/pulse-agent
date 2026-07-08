import { type ButtonHTMLAttributes } from 'react';
import './index.css';

type ButtonVariant = 'primary' | 'secondary' | 'danger';
type ButtonSize = 'sm' | 'md';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** sm = 30px (cfg-* metrics), md = 34px (workspace-settings-* metrics). */
  size?: ButtonSize;
}

/**
 * Button — the blessed CTA button. Consolidates the `cfg-*-btn` and
 * `workspace-settings-*-btn` clusters (which differed only in height).
 * Passes standard button attributes through; `type` defaults to 'button'.
 * `className` merges onto the `<button>` element itself.
 */
export const Button = ({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: Props) => {
  const classes = ['ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`];
  if (className) classes.push(className);
  return <button type={type} className={classes.join(' ')} {...rest} />;
};
