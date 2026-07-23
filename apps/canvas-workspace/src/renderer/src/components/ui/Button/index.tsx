import { forwardRef, type ButtonHTMLAttributes } from 'react';
import './index.css';

// Once per session — a lint nudge for missing icon aria-labels, not a log
// stream (fires per-render otherwise; import.meta.env.DEV doesn't typecheck
// under this tsconfig, so the warn stays ungated but deduped).
let warnedIconAriaLabel = false;

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'icon';
/** xs/sm/md apply to every variant; `lg` (32px) is icon-only for now — no
 *  CTA cluster needed a third text-button height when that was added. */
type ButtonSize = 'xs' | 'sm' | 'md' | 'lg';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** xs = 24px (iframe review-popover `.iframe-review-mini-btn` metrics) /
   *  22px icon (iframe toolbar `.iframe-bar-btn` metrics), sm = 30px
   *  (cfg-* metrics) / 24px icon, md = 34px (workspace-settings-* metrics) /
   *  28px icon, lg = 32px icon (icon-only). */
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
 *
 * Forwards `ref` to the underlying `<button>` so callers can restore
 * focus or anchor popovers to the trigger.
 */
export const Button = forwardRef<HTMLButtonElement, Props>(({
  variant = 'secondary',
  size = 'md',
  type = 'button',
  className,
  ...rest
}, ref) => {
  if (variant === 'icon' && !rest['aria-label'] && !warnedIconAriaLabel) {
    warnedIconAriaLabel = true;
    console.warn('ui/Button variant="icon" is missing an aria-label — icon-only buttons need one.');
  }
  const classes = ['ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`];
  if (className) classes.push(className);
  return <button ref={ref} type={type} className={classes.join(' ')} {...rest} />;
});

Button.displayName = 'Button';
