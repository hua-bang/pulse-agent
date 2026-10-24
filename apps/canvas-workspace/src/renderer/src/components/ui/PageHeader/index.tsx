import type { ReactNode } from 'react';
import './index.css';

interface Props {
  /** Small uppercase label above the title, such as the page's group. */
  kicker?: ReactNode;
  title: ReactNode;
  /** Sits on the title line, for example a list/graph view switch. */
  titleAccessory?: ReactNode;
  description?: ReactNode;
  /** Right-aligned page actions. */
  actions?: ReactNode;
  /** Extra class merged onto the root, for page width and spacing. */
  className?: string;
}

/**
 * ui/PageHeader — the blessed header of a full page: kicker, title, view
 * switch, description, and actions. Scheduled, Skills, Plugins, and
 * Knowledge each had their own copy of this block with drifting spacing.
 * Pure layout shell: callers pass translated copy.
 */
export const PageHeader = ({
  kicker,
  title,
  titleAccessory,
  description,
  actions,
  className,
}: Props) => {
  const classes = ['ui-page-header', className].filter(Boolean).join(' ');
  return (
    <header className={classes}>
      <div className="ui-page-header__text">
        {kicker != null && <span className="ui-page-header__kicker">{kicker}</span>}
        <div className="ui-page-header__title-row">
          <h1 className="ui-page-header__title">{title}</h1>
          {titleAccessory}
        </div>
        {description != null && <p className="ui-page-header__description">{description}</p>}
      </div>
      {actions != null && <div className="ui-page-header__actions">{actions}</div>}
    </header>
  );
};
