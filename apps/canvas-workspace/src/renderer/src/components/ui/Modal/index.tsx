import { useRef, type ReactNode } from 'react';
import { useEscapeClose } from '../../../hooks/useEscapeClose';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { Portal } from '../Portal';
import './index.css';

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  /** Max card width in px; clamps to `min(width, 100%)`. */
  width?: number;
  /** id of the element that labels the dialog (`aria-labelledby`). */
  labelledBy?: string;
  /** Extra class on the card (the dialog element itself), e.g.
   *  `ui-modal--tall` for scrollable content. */
  className?: string;
}

/**
 * Modal — the one blessed centered-overlay shell. Portals to `document.body`,
 * closes on backdrop press (`target === currentTarget`) and on ESC (the
 * canonical `useEscapeClose` capture-phase hook), and carries the dialog
 * role/aria. Traps focus inside the card while open (`useFocusTrap`) and
 * restores it to the previously focused element on close. Sits on the
 * app-shell dialog tier (`--layer-dialog`). Callers supply the card's inner
 * markup (header/body/footer) as children. `className` lands on the card
 * (the dialog-role element), not the backdrop.
 */
export const Modal = ({ open, onClose, children, width, labelledBy, className }: Props) => {
  useEscapeClose(open, onClose);
  const cardRef = useRef<HTMLDivElement>(null);
  useFocusTrap(open, cardRef);

  if (!open) return null;

  return (
    <Portal>
      <div
        className="ui-modal-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          ref={cardRef}
          className={className ? `ui-modal ${className}` : 'ui-modal'}
          role="dialog"
          aria-modal="true"
          aria-labelledby={labelledBy}
          style={width ? { width: `min(${width}px, 100%)` } : undefined}
        >
          {children}
        </div>
      </div>
    </Portal>
  );
};
