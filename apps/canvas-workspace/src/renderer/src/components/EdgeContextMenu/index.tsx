import { createPortal } from 'react-dom';
import '../NodeContextMenu/index.css';
import './index.css';
import { useViewportClampedPosition } from '../../hooks/useViewportClampedPosition';
import { useMenuKeyboardNav } from '../../hooks/useMenuKeyboardNav';
import { useClickOutside } from '../../hooks/useClickOutside';
import { PencilIcon, SettingsIcon, TrashIcon } from '../icons';
import { useI18n } from '../../i18n';

interface Props {
  x: number;
  y: number;
  edgeId: string;
  onEditLabel: (edgeId: string) => void;
  onEditStyle: (edgeId: string) => void;
  onDelete: (edgeId: string) => void;
  onClose: () => void;
}

/**
 * Right-click menu for canvas connections. Before this, every edge
 * operation hid behind less discoverable gestures (double-click for the
 * label, select-then-style-panel, select-then-Delete); this surfaces
 * them in the same right-click pattern the rest of the canvas uses.
 */
export const EdgeContextMenu = ({ x, y, edgeId, onEditLabel, onEditStyle, onDelete, onClose }: Props) => {
  const { t } = useI18n();
  const { ref: menuRef, pos } = useViewportClampedPosition<HTMLDivElement>(x, y);
  useMenuKeyboardNav(menuRef, onClose);
  useClickOutside(menuRef, onClose);

  const menu = (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="context-menu-title">{t('canvas.edgeMenu.title')}</div>
      <button
        className="context-menu-item" role="menuitem"
        onClick={() => { onEditLabel(edgeId); onClose(); }}
      >
        <span className="context-menu-icon">
          <PencilIcon size={15} />
        </span>
        <span className="context-menu-label">
          <strong>{t('canvas.edgeMenu.editLabel')}</strong>
          <small>{t('canvas.edgeMenu.editLabelDesc')}</small>
        </span>
      </button>
      <button
        className="context-menu-item" role="menuitem"
        onClick={() => { onEditStyle(edgeId); onClose(); }}
      >
        <span className="context-menu-icon">
          <SettingsIcon size={15} />
        </span>
        <span className="context-menu-label">
          <strong>{t('canvas.edgeMenu.editStyle')}</strong>
          <small>{t('canvas.edgeMenu.editStyleDesc')}</small>
        </span>
      </button>
      <button
        className="context-menu-item context-menu-item--danger" role="menuitem"
        onClick={() => { onDelete(edgeId); onClose(); }}
      >
        <span className="context-menu-icon">
          <TrashIcon size={15} />
        </span>
        <span className="context-menu-label">
          <strong>{t('canvas.edgeMenu.delete')}</strong>
          <small>{t('canvas.edgeMenu.deleteDesc')}</small>
        </span>
      </button>
    </div>
  );

  return createPortal(menu, document.body);
};
