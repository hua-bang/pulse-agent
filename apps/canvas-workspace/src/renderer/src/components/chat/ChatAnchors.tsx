import { useCallback, useEffect, useId, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { ListLinesIcon } from '../icons';
import { useI18n } from '../../i18n';
import { DropdownShell } from '../ui';
import type { ChatAnchor } from './utils/anchors';

interface ChatAnchorsProps {
  anchors: ChatAnchor[];
  onJump: (index: number) => void;
}

const HOVER_CLOSE_DELAY = 220;

/**
 * DropdownShell-shelled (was a bespoke useClickOutside+useMenuKeyboardNav
 * pair — see ui-reuse-burndown.md's API-extension batch). The hover-driven
 * open/close is layered ON TOP of the shell's own open state via the
 * trigger render-prop's `toggle`, mirrored into refs so the mouseenter/
 * mouseleave/focus handlers (which don't re-run on every render) always
 * command the LATEST toggle against the LATEST open value, gated so hover
 * only ever opens-when-closed or closes-when-open (never double-toggles).
 */
export const ChatAnchors = ({ anchors, onJump }: ChatAnchorsProps) => {
  const { t } = useI18n();
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openRef = useRef(false);
  const toggleRef = useRef<() => void>(() => {});
  const closeTimerRef = useRef<number | undefined>(undefined);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current !== undefined) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = undefined;
    }
  }, []);

  const openNow = useCallback(() => {
    cancelClose();
    if (!openRef.current) toggleRef.current();
  }, [cancelClose]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = undefined;
      if (openRef.current) toggleRef.current();
    }, HOVER_CLOSE_DELAY);
  }, [cancelClose]);

  useEffect(() => () => cancelClose(), [cancelClose]);

  if (anchors.length === 0) return null;

  const anchorLabel = t('chat.anchors', { count: anchors.length });

  return (
    <div className="chat-anchors" onMouseEnter={openNow} onMouseLeave={scheduleClose}>
      <DropdownShell
        align="end"
        role="menu"
        ariaLabel={t('chat.anchorsMenuLabel')}
        panelId={menuId}
        panelClassName="chat-anchors-menu"
        onOpenChange={(open, reason) => {
          // Keyboard (Escape) close restores focus to the trigger; a
          // click-outside close does not — the user's attention already
          // moved elsewhere, so yanking focus back would fight that.
          if (!open && reason === 'escape') triggerRef.current?.focus();
        }}
        trigger={({ open, toggle }) => {
          openRef.current = open;
          toggleRef.current = toggle;
          return (
            <button
              ref={triggerRef}
              type="button"
              className="chat-panel-action-btn"
              title={anchorLabel}
              aria-label={anchorLabel}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-controls={open ? menuId : undefined}
              onFocus={openNow}
              onClick={toggle}
              onKeyDown={(event: ReactKeyboardEvent<HTMLButtonElement>) => {
                if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                // Once open, the shell's own useMenuKeyboardNav (global
                // scope) already owns ArrowDown/Up — it stops propagation
                // before this handler would see the event, so this branch
                // only ever runs to open the panel from a keyboard press.
                if (open) return;
                event.preventDefault();
                event.stopPropagation();
                cancelClose();
                toggle();
              }}
            >
              <ListLinesIcon size={16} />
            </button>
          );
        }}
      >
        {({ close }) => (
          <>
            <div className="chat-anchors-menu-label">{anchorLabel}</div>
            <div className="chat-anchors-menu-list">
              {anchors.map((anchor, i) => (
                <button
                  key={anchor.index}
                  type="button"
                  role="menuitem"
                  className="chat-anchors-menu-item"
                  data-menu-autofocus={i === 0 ? 'true' : undefined}
                  onClick={() => {
                    close();
                    onJump(anchor.index);
                  }}
                  title={t('chat.anchorOption', { label: anchor.label })}
                >
                  <span className="chat-anchors-menu-item-num">{i + 1}</span>
                  <span className="chat-anchors-menu-item-text">{anchor.label}</span>
                </button>
              ))}
            </div>
          </>
        )}
      </DropdownShell>
    </div>
  );
};
