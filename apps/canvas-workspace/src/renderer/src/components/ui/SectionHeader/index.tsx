import type { ReactNode } from 'react';
import './index.css';

interface Props {
  title: ReactNode;
  description?: ReactNode;
  /** Extra class merged onto the root wrapper. */
  className?: string;
}

/**
 * ui/SectionHeader — the blessed title+description pair for a settings-style
 * section intro. Consolidates the `*-section-title`/`*-section-desc` cluster
 * that was byte-identical (or property-identical) across `Settings/*`
 * (e.g. `updates-section-title`/`updates-section-desc` and
 * `language-section-title`/`language-section-desc` — the 15px/700 title +
 * muted 12px desc pattern). Pure layout shell: no state, no i18n — callers
 * pass already-translated copy via `title`/`description`.
 */
export const SectionHeader = ({ title, description, className }: Props) => {
  const classes = ['ui-section-header', className].filter(Boolean).join(' ');
  return (
    <div className={classes}>
      <div className="ui-section-header__title">{title}</div>
      {description != null && (
        <div className="ui-section-header__description">{description}</div>
      )}
    </div>
  );
};
