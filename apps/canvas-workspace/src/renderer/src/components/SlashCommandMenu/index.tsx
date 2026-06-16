import { useEffect } from 'react';
import './index.css';
import { createPortal } from 'react-dom';
import { useViewportClampedPosition } from '../../hooks/useViewportClampedPosition';
import { useClickOutside } from '../../hooks/useClickOutside';

export interface SlashCommandDef {
  id: string;
  label: string;
  desc: string;
  icon: string;
}

interface Props {
  x: number;
  y: number;
  selectedIndex: number;
  items: SlashCommandDef[];
  onSelect: (cmd: SlashCommandDef) => void;
  onClose: () => void;
}

export const SlashCommandMenu = ({
  x,
  y,
  selectedIndex,
  items,
  onSelect,
  onClose,
}: Props) => {
  // Keep the menu fully on-screen: typing `/` near the right or bottom
  // window edge would otherwise push the list out of the viewport.
  const { ref: menuRef, pos } = useViewportClampedPosition<HTMLDivElement>(x, y + 6);

  // Scroll active item into view
  useEffect(() => {
    const el = menuRef.current?.querySelector('.slash-menu-item--active') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Close on outside click
  useClickOutside(menuRef, onClose);

  if (items.length === 0) return null;

  // Portal into document.body so position:fixed is relative to the viewport,
  // not to the canvas-transform ancestor (which has a CSS transform that
  // would otherwise shift fixed-positioned children away from the viewport).
  return createPortal(
    <div
      ref={menuRef}
      className="slash-menu"
      style={{ position: 'fixed', left: pos.left, top: pos.top, zIndex: 9000 }}
    >
      <div className="slash-menu-header">BLOCKS</div>
      {items.map((item, i) => (
        <button
          key={item.id}
          className={`slash-menu-item${i === selectedIndex ? ' slash-menu-item--active' : ''}`}
          onMouseDown={(e) => {
            e.preventDefault();
            onSelect(item);
          }}
        >
          <span className="slash-menu-icon">{item.icon}</span>
          <span className="slash-menu-label">
            <strong>{item.label}</strong>
            <small>{item.desc}</small>
          </span>
        </button>
      ))}
    </div>,
    document.body,
  );
};
