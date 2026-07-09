import { type ButtonHTMLAttributes } from 'react';
import './index.css';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'icon';
/** sm/md apply to every variant; `lg` (32px) is icon-only for now — no CTA
 *  cluster needed a third text-button height when this was added. */
type ButtonSize = 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** sm = 30px (cfg-* metrics) / 24px icon, md = 34px (workspace-settings-*
   *  metrics) / 28px icon, lg = 32px icon (icon-only). */
  size?: ButtonSize;
}

/**
 * Button — the blessed CTA button. Consolidates the `cfg-*-btn` and
 * `workspace-settings-*-btn` clusters (which differed only in height).
 * Passes standard button attributes through; `type` defaults to 'button'.
 * `className` merges onto the `<button>` element itself.
 *
 * `variant="icon"` is the blessed icon-only button — square (equal
 * width/height per `size`), transparent background, hover tint, no text
 * label. The child is the icon; since there's no visible label, callers
 * MUST pass `aria-label` (a dev-time console.warn fires when it's missing).
 */
export const Button = ({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...rest
}: Props) => {
  if (variant === 'icon' && !rest['aria-label']) {
    console.warn('ui/Button variant="icon" is missing an aria-label — icon-only buttons need one.');
  }
  const classes = ['ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`];
  if (className) classes.push(className);
  return <button type={type} className={classes.join(' ')} {...rest} />;
};
