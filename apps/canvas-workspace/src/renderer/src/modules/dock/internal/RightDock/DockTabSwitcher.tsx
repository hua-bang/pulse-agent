/**
 * Browser-style all-tabs entry. The horizontal strip may scroll, but this
 * fixed trigger keeps every tab reachable with a pointer or keyboard.
 */
import { CaretDown } from '@phosphor-icons/react';
import { useRef, useState } from 'react';
import { useGuestInteractionShield } from '../../../../hooks/useGuestInteractionShield';
import { useI18n } from '../../../../i18n';
import { Button, Popover } from '../../../../components/ui';
import { DockAgentTabIcon } from './DockAgentTabIcon';
import { DockTabIcon } from './DockTabIcon';
import type { DockTabSwitcherItem } from './dock-tab-items';

interface Props {
  items: readonly DockTabSwitcherItem[];
  activeTabId: string | null;
  onActivate: (id: string) => void;
}

export const DockTabSwitcher = ({ items, activeTabId, onActivate }: Props) => {
  const { t } = useI18n();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useGuestInteractionShield(open);

  const close = (reason?: 'escape' | 'outside') => {
    setOpen(false);
    if (reason === 'escape') triggerRef.current?.focus();
  };

  return (
    <>
      <Button
        ref={triggerRef}
        variant="icon"
        size="sm"
        className="right-dock__tab-switcher"
        aria-label={t('rightDock.allTabs')}
        title={t('rightDock.allTabs')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <CaretDown size={14} weight="bold" aria-hidden="true" />
      </Button>
      {open && (
        <Popover
          anchorRef={triggerRef}
          placement="bottom"
          align="end"
          gap={6}
          ariaLabel={t('rightDock.allTabs')}
          className="context-menu context-menu--in-dock right-dock__tab-switcher-menu"
          onClose={close}
        >
          {items.map((item) => (
            <Button
              key={item.id}
              size="sm"
              className="context-menu-item right-dock__tab-switcher-item"
              role="menuitemradio"
              aria-checked={item.id === activeTabId}
              data-menu-autofocus={item.id === activeTabId ? 'true' : undefined}
              title={item.title}
              onClick={() => {
                setOpen(false);
                onActivate(item.id);
              }}
            >
              {item.kind === 'terminal' && item.agentType
                ? <DockAgentTabIcon agentType={item.agentType} />
                : <DockTabIcon kind={item.kind} faviconUrl={item.faviconUrl} />}
              <span className="context-menu-label">
                <strong>{item.title}</strong>
              </span>
            </Button>
          ))}
        </Popover>
      )}
    </>
  );
};
