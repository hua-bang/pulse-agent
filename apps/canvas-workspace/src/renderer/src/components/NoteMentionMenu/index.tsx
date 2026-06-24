import { useEffect } from 'react';
import './index.css';
import { createPortal } from 'react-dom';
import type { CanvasNode } from '../../types';
import { useViewportClampedPosition } from '../../hooks/useViewportClampedPosition';
import { useClickOutside } from '../../hooks/useClickOutside';
import { CANVAS_NODE_TYPE_LABEL_KEY } from '../../utils/nodeTypeI18n';
import { useI18n } from '../../i18n';

interface Props {
  x: number;
  y: number;
  items: CanvasNode[];
  selectedIndex: number;
  onSelect: (node: CanvasNode) => void;
  onClose: () => void;
}

export const NoteMentionMenu = ({ x, y, items, selectedIndex, onSelect, onClose }: Props) => {
  const { t } = useI18n();
  const { ref: menuRef, pos } = useViewportClampedPosition<HTMLDivElement>(x, y + 6);
  const activeIndex = Math.min(selectedIndex, items.length - 1);

  useEffect(() => {
    const el = menuRef.current?.querySelector('.note-mention-menu-item--active') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  useClickOutside(menuRef, onClose);

  if (items.length === 0) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="note-mention-menu"
      role="listbox"
      aria-label={t('nodeMention.title')}
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 'var(--layer-note-popover)' }}
    >
      {items.map((node, i) => (
        <button
          key={node.id}
          className={`note-mention-menu-item${i === activeIndex ? ' note-mention-menu-item--active' : ''}`}
          role="option"
          aria-selected={i === activeIndex}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(node);
          }}
        >
          <span className={`note-mention-menu-badge note-mention-menu-badge--${node.type}`}>
            {t(CANVAS_NODE_TYPE_LABEL_KEY[node.type])}
          </span>
          <span className="note-mention-menu-title">{node.title || t('nodeMention.untitled')}</span>
        </button>
      ))}
    </div>,
    document.body,
  );
};
