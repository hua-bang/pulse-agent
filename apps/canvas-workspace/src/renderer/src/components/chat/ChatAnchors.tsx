import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { ListLinesIcon } from '../icons';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useI18n } from '../../i18n';
import { useMenuKeyboardNav } from '../../hooks/useMenuKeyboardNav';
import type { ChatAnchor } from './utils/anchors';

interface ChatAnchorsProps {
  anchors: ChatAnchor[];
  onJump: (index: number) => void;
}

const HOVER_CLOSE_DELAY = 220;

export const ChatAnchors = ({ anchors, onJump }: ChatAnchorsProps) => {
  const { t } = useI18n();
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | undefined>(undefined);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
      closeTimerRef.current = undefined;
    }, HOVER_CLOSE_DELAY);
  }, [cancelClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  const closeMenu = useCallback((restoreFocus = false) => {
    cancelClose();
    setOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, [cancelClose]);

  useClickOutside(wrapperRef, () => closeMenu(false), open);
  useMenuKeyboardNav(menuRef, () => closeMenu(true), open);

  const handleSelect = useCallback((index: number) => {
    closeMenu(false);
    onJump(index);
  }, [closeMenu, onJump]);

  const openMenuFromKeyboard = useCallback((event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    event.stopPropagation();
    cancelClose();
    if (!open) {
      setOpen(true);
      return;
    }
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    const target = event.key === 'ArrowUp' ? items[items.length - 1] : items[0];
    target?.focus();
  }, [cancelClose, open]);

  if (anchors.length === 0) return null;

  const anchorLabel = t('chat.anchors', { count: anchors.length });

  return (
    <div
      className="chat-anchors"
      ref={wrapperRef}
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={triggerRef}
        type="button"
        className="chat-panel-action-btn"
        title={anchorLabel}
        aria-label={anchorLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onFocus={() => { cancelClose(); setOpen(true); }}
        onClick={() => setOpen(prev => !prev)}
        onKeyDown={openMenuFromKeyboard}
      >
        <ListLinesIcon size={16} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="chat-anchors-menu"
          role="menu"
          aria-label={t('chat.anchorsMenuLabel')}
        >
          <div className="chat-anchors-menu-label">{anchorLabel}</div>
          <div className="chat-anchors-menu-list">
            {anchors.map((anchor, i) => (
              <button
                key={anchor.index}
                type="button"
                role="menuitem"
                className="chat-anchors-menu-item"
                data-menu-autofocus={i === 0 ? 'true' : undefined}
                onClick={() => handleSelect(anchor.index)}
                title={t('chat.anchorOption', { label: anchor.label })}
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
