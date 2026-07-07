/**
 * Drawer — shared shell for right-side modal settings panels. Promoted from
 * the former `SettingsDrawer`.
 *
 * Owns: portal mount, backdrop, slide-in animation, ESC (via the canonical
 * `useEscapeClose` hook) / backdrop close, and the kicker + title +
 * close-button header. Callers render their own body and footer as children.
 *
 * Used by the unified Settings drawer and WorkspaceSettingsDrawer.
 */

import { type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
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
  children: ReactNode;
}

export const Drawer = ({
  open,
  onClose,
  kicker,
  title,
  ariaLabel,
  width = 640,
  closeAriaLabel = 'Close',
  children,
}: Props) => {
  useEscapeClose(open, onClose);

  if (!open) return null;

  return createPortal(
    <div className="ui-drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="ui-drawer"
        style={{ width: `min(100vw, ${width}px)` }}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={ariaLabel}
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
            aria-label={closeAriaLabel}
          >
            ×
          </button>
        </div>
        {children}
      </aside>
    </div>,
    document.body,
  );
};
