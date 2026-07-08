/**
 * SettingsDrawer — shared shell for right-side modal settings panels.
 *
 * Owns: portal mount, backdrop, slide-in animation, ESC/backdrop close,
 * and the kicker + title + close-button header. Callers render their own
 * body and footer as children.
 *
 * Used by WorkspaceSettingsDrawer and the unified Settings drawer.
 */

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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

export const SettingsDrawer = ({
  open,
  onClose,
  kicker,
  title,
  ariaLabel,
  width = 640,
  closeAriaLabel = 'Close',
  children,
}: Props) => {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="settings-drawer-backdrop" onMouseDown={onClose}>
      <aside
        className="settings-drawer"
        style={{ width: `min(100vw, ${width}px)` }}
        onMouseDown={(event) => event.stopPropagation()}
        aria-label={ariaLabel}
      >
        <div className="settings-drawer-header">
          <div>
            <div className="settings-drawer-kicker">{kicker}</div>
            <h2>{title}</h2>
          </div>
          <button
            type="button"
            className="settings-drawer-close"
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
