/**
 * Drawer — shared shell for right-side modal settings panels. Promoted from
 * the former `SettingsDrawer`.
 *
 * Owns: portal mount, backdrop, slide-in animation, ESC (via the canonical
 * `useEscapeClose` hook) / backdrop close, dialog role/aria, focus trap
 * (`useFocusTrap`, restores focus on close), and the kicker + title +
 * close-button header. Callers render their own body and footer as children.
 * `className` merges onto the `<aside>` (the dialog-role element).
 *
 * Used by the unified Settings drawer and WorkspaceSettingsDrawer.
 */

import { useRef, type ReactNode } from 'react';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import { useI18n } from '../../../i18n';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Portal } from '../Portal';
import './index.css';

interface Props {
  open: boolean;
  onClose: () => void;
  kicker: string;
  title: ReactNode;
  ariaLabel: string;
  /** Max width in px; the drawer clamps to `min(100vw, width)`. Default 640. */
  width?: number;
  closeAriaLabel?: string;
  /** Extra class merged onto the `<aside>`. */
  className?: string;
  children: ReactNode;
}

export const Drawer = ({
  open,
  onClose,
  kicker,
  title,
  ariaLabel,
  width = 640,
  closeAriaLabel,
  className,
  children,
}: Props) => {
  const { t } = useI18n();
  useEscapeClose(open, onClose);
  const asideRef = useRef<HTMLElement>(null);
  useFocusTrap(open, asideRef);

  if (!open) return null;

  return (
    <Portal>
      <div className="ui-drawer-backdrop" onMouseDown={onClose}>
        <aside
          ref={asideRef}
          className={className ? `ui-drawer ${className}` : 'ui-drawer'}
          style={{ width: `min(100vw, ${width}px)` }}
          onMouseDown={(event) => event.stopPropagation()}
          aria-label={ariaLabel}
          role="dialog"
          aria-modal="true"
        >
          <div className="ui-drawer-header">
            <div>
              <div className="ui-drawer-kicker">{kicker}</div>
              <h2>{title}</h2>
            </div>
            <button
              type="button"
              className="ui-drawer-close"
              onClick={onClose}
              aria-label={closeAriaLabel ?? t('shell.close')}
            >
              ×
            </button>
          </div>
          {children}
        </aside>
      </div>
    </Portal>
  );
};
