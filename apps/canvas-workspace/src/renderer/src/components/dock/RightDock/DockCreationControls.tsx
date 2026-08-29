import { lazy, Suspense, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useI18n } from '../../../i18n';
import { PlusIcon } from '../../icons';
import { Button } from '../../ui';
import type { DockStore } from './dock-store';

const NewDockTabMenu = lazy(() => (
  import('./NewDockTabMenu').then((module) => ({ default: module.NewDockTabMenu }))
));

interface Props {
  store: DockStore;
  showTerminal: boolean;
  newTabTitle: string;
  pickerOpen?: boolean;
  onOpenNode: () => void;
  onOpenCanvas: () => void;
}

/** Grace period for the pointer to cross the gap between the + trigger and
 *  the portaled menu panel (or briefly leave and come back) before the
 *  hover-opened menu closes. */
const HOVER_CLOSE_DELAY_MS = 240;

export const DockCreationControls = ({ store, showTerminal, newTabTitle, pickerOpen = false, onOpenNode, onOpenCanvas }: Props) => {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  // Hover-triggered menu: entering the trigger (or the panel) opens/keeps it,
  // leaving either schedules a delayed close so the pointer can travel
  // between them. Click still opens for keyboard/tap users; dismissal is
  // Escape, an outside press, or moving the pointer away.
  const closeTimerRef = useRef<number | null>(null);
  const cancelScheduledClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);
  const openMenu = useCallback(() => {
    cancelScheduledClose();
    setMenuOpen(true);
  }, [cancelScheduledClose]);
  const scheduleClose = useCallback(() => {
    cancelScheduledClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setMenuOpen(false);
    }, HOVER_CLOSE_DELAY_MS);
  }, [cancelScheduledClose]);
  useEffect(() => cancelScheduledClose, [cancelScheduledClose]);

  return (
    <>
      <span
        ref={anchorRef}
        className="right-dock__new-tab-menu"
        onMouseEnter={() => {
          if (!pickerOpen) openMenu();
        }}
        onMouseLeave={scheduleClose}
      >
        <Button
          variant="icon"
          size="sm"
          className="right-dock__new-link"
          aria-label={t('rightDock.newWebTab')}
          title={t('rightDock.newWebTab')}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? panelId : undefined}
          onClick={() => {
            setMenuOpen(false);
            store.newLink(newTabTitle);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              openMenu();
            }
          }}
        >
          <PlusIcon size={16} />
        </Button>
        {menuOpen && (
          <Suspense fallback={null}>
            <NewDockTabMenu
              anchorRef={anchorRef}
              panelId={panelId}
              showTerminal={showTerminal}
              onClose={() => setMenuOpen(false)}
              onOpenNode={onOpenNode}
              onOpenCanvas={onOpenCanvas}
              onNewWebTab={() => store.newLink(newTabTitle)}
              onNewTerminalTab={() => store.newTerminal()}
              onHoverEnter={cancelScheduledClose}
              onHoverLeave={scheduleClose}
            />
          </Suspense>
        )}
      </span>
    </>
  );
};
