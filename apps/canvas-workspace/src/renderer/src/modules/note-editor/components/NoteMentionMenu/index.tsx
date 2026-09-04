import { useEffect } from 'react';
import './index.css';
import type { CanvasNode } from '../../../../types';
import { CANVAS_NODE_TYPE_LABEL_KEY } from '../../../../utils/nodeTypeI18n';
import { useI18n } from '../../../../i18n';
import { Popover } from '../../../../components/ui';

interface Props {
  panelId: string;
  x: number;
  y: number;
  items: CanvasNode[];
  selectedIndex: number;
  onSelect: (node: CanvasNode) => void;
  onClose: () => void;
}

export const NoteMentionMenu = ({
  panelId,
  x,
  y,
  items,
  selectedIndex,
  onSelect,
  onClose,
}: Props) => {
  const { t } = useI18n();
  const activeIndex = Math.min(selectedIndex, items.length - 1);

  useEffect(() => {
    const el = document
      .getElementById(panelId)
      ?.querySelector('.note-mention-menu-item--active') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [panelId, selectedIndex]);

  if (items.length === 0) return null;

  return (
    <Popover
      x={x}
      y={y + 6}
      className="note-mention-menu"
      role="listbox"
      ariaLabel={t('nodeMention.title')}
      panelId={panelId}
      autoFocus={false}
      keyboardNavigation={false}
      closeOnCanvasMotion
      onClose={onClose}
    >
      {items.map((node, i) => (
        <button
          key={node.id}
          id={`${panelId}-${node.id}`}
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
    </Popover>
  );
};
