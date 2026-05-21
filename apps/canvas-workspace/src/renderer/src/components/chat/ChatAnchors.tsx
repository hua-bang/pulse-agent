import { useCallback, useEffect, useRef, useState } from 'react';
import { ListLinesIcon } from '../icons';
import type { ChatAnchor } from './utils/anchors';

interface ChatAnchorsProps {
  anchors: ChatAnchor[];
  onJump: (index: number) => void;
}

export const ChatAnchors = ({ anchors, onJump }: ChatAnchorsProps) => {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (wrapperRef.current && target && !wrapperRef.current.contains(target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, [open]);

  const handleSelect = useCallback((index: number) => {
    onJump(index);
    setOpen(false);
  }, [onJump]);

  if (anchors.length === 0) return null;

  return (
    <div className="chat-anchors" ref={wrapperRef}>
      <button
        type="button"
        className="chat-panel-action-btn"
        title={`聊天锚点 (${anchors.length})`}
        aria-label="聊天锚点"
        aria-expanded={open}
        onClick={() => setOpen(prev => !prev)}
      >
        <ListLinesIcon size={16} />
      </button>
      {open && (
        <div className="chat-anchors-menu" role="listbox">
          <div className="chat-anchors-menu-label">Anchors · {anchors.length}</div>
          <div className="chat-anchors-menu-list">
            {anchors.map((anchor, i) => (
              <button
                key={anchor.index}
                type="button"
                role="option"
                aria-selected={false}
                className="chat-anchors-menu-item"
                onClick={() => handleSelect(anchor.index)}
                title={anchor.label}
              >
                <span className="chat-anchors-menu-item-num">{i + 1}</span>
                <span className="chat-anchors-menu-item-text">{anchor.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
