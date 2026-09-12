import { CaretDown } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useGuestInteractionShield } from '../../../../platform/browser/useGuestInteractionShield';
import { useI18n } from '../../../../i18n';
import { Button, Popover, TextField } from '../../../../components/ui';
import { isImeComposing } from '../../../../utils/ime';
import { DockAgentTabIcon } from './DockAgentTabIcon';
import { DockTabIcon } from './DockTabIcon';
import { dockTabDomain, filterDockTabs, type DockTabSwitcherItem } from './dock-tab-items';
import './dock-reading.css';

interface Props {
  items: readonly DockTabSwitcherItem[];
  activeTabId: string | null;
  splitTabIds?: readonly string[];
  onActivate: (id: string) => void;
  closedTabs?: readonly DockTabSwitcherItem[];
  onReopen?: (offset: number) => void;
}

export const DockTabSwitcher = ({ items, activeTabId, splitTabIds, onActivate, closedTabs = [], onReopen }: Props) => {
  const { t } = useI18n();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  useGuestInteractionShield(open);
  useEffect(() => {
    if (activeTabId) setRecent(current => [activeTabId, ...current.filter(id => id !== activeTabId)].slice(0, 100));
  }, [activeTabId]);
  useEffect(() => {
    if (!open) return;
    // The anchored popover starts hidden while measured. Focus only once it paints.
    const frame = requestAnimationFrame(() => searchRef.current?.querySelector('input')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);
  const ordered = [...items].sort((a, b) => {
    const rank = (id: string) => recent.includes(id) ? recent.indexOf(id) : recent.length;
    return rank(a.id) - rank(b.id);
  });
  const rows = [
    ...filterDockTabs(ordered, query).map(item => ({ item, closedIndex: -1 })),
    ...closedTabs.flatMap((item, closedIndex) => filterDockTabs([item], query).length ? [{ item, closedIndex }] : []),
  ];
  const currentIndex = Math.min(selected, Math.max(0, rows.length - 1));
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${currentIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, currentIndex, listId]);
  const close = (reason?: 'escape' | 'outside') => {
    setOpen(false);
    if (reason === 'escape') triggerRef.current?.focus();
  };
  const choose = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setOpen(false);
    if (row.closedIndex >= 0) onReopen?.(row.closedIndex);
    else onActivate(row.item.id);
  };
  const title = t('rightDock.allTabs');
  return (
    <>
      <Button ref={triggerRef} size="sm" className="right-dock__tab-search-trigger"
        aria-label={title} title={title} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setQuery(''); setSelected(0); setOpen(value => !value); }}>
        {t('rightDock.tabCount', { count: items.length })}<CaretDown size={12} />
      </Button>
      {open && (
        <Popover anchorRef={triggerRef} placement="bottom" align="end" gap={6}
          role="dialog" ariaLabel={title} autoFocus={false} keyboardNavigation={false}
          className="context-menu context-menu--in-dock right-dock__tab-switcher-menu right-dock__tab-search"
          onClose={close}>
          <div ref={searchRef} className="right-dock__tab-search-input">
            <TextField aria-label={t('rightDock.searchTabs')} placeholder={t('rightDock.searchTabs')}
              role="combobox" aria-expanded aria-controls={listId} aria-autocomplete="list"
              aria-activedescendant={rows.length ? `${listId}-${currentIndex}` : undefined}
              value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }}
              onKeyDown={event => {
                if (isImeComposing(event.nativeEvent)) return;
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault(); event.stopPropagation();
                  setSelected(Math.max(0, Math.min(rows.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1))));
                } else if (event.key === 'Enter') { event.preventDefault(); choose(currentIndex); }
              }} />
          </div>
          <div id={listId} role="listbox" aria-label={title} className="right-dock__tab-search-results">
            {rows.map(({ item, closedIndex }, index) => (
              <div key={`${closedIndex}:${item.id}`}>
                {(index === 0 || (closedIndex >= 0 && rows[index - 1].closedIndex < 0)) && (
                  <div className="right-dock__tab-search-heading">{t(closedIndex >= 0 ? 'rightDock.recentlyClosed' : 'rightDock.recentTabs')}</div>
                )}
                <Button id={`${listId}-${index}`} size="sm" role="option" aria-selected={index === currentIndex}
                  className="right-dock__tab-search-row" title={item.url || item.title}
                  onMouseEnter={() => setSelected(index)} onClick={() => choose(index)}>
                  {item.kind === 'terminal' && item.agentType
                    ? <DockAgentTabIcon agentType={item.agentType} />
                    : <DockTabIcon kind={item.kind} faviconUrl={item.faviconUrl} />}
                  <span className="right-dock__tab-search-label"><strong>{item.title}</strong>
                    {item.url && <small>{dockTabDomain(item.url)}</small>}</span>
                  {closedIndex < 0 && (splitTabIds?.includes(item.id) || activeTabId === item.id) && (
                    <span className="right-dock__tab-position">{t(splitTabIds?.[1] === item.id ? 'rightDock.pinnedRight'
                      : splitTabIds?.[0] === item.id ? 'rightDock.browsingLeft' : 'rightDock.currentTab')}</span>
                  )}
                </Button>
              </div>
            ))}
          </div>
          {!rows.length && <p role="status" className="right-dock__tab-search-empty">{t('rightDock.noMatchingTabs')}</p>}
        </Popover>
      )}
    </>
  );
};
