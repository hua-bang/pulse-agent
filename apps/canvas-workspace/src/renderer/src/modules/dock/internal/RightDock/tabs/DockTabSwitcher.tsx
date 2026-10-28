import { CaretDown, Columns, X } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState } from 'react';
import { useGuestInteractionShield } from '../../../../../platform/browser/useGuestInteractionShield';
import { useI18n } from '../../../../../i18n';
import { Button, Popover, TextField } from '../../../../../components/ui';
import { isImeComposing } from '../../../../../utils/ime';
import { formatRelativeTime } from '../../../../../utils/relativeTime';
import type { DockTabArchiveReason } from '../links/dock-tab-archive';
import { DockAgentTabIcon } from './DockAgentTabIcon';
import { DockTabIcon } from './DockTabIcon';
import { dockTabDomain, filterDockTabs, type DockTabSwitcherItem } from './dock-tab-items';
import '../reading/dock-reading.css';

/** Archived rows shown before "show all"; a search always lists every match. */
const ARCHIVE_PREVIEW_COUNT = 5;

export interface DockArchivedSwitcherItem {
  item: DockTabSwitcherItem;
  closedAt: number;
  reason: DockTabArchiveReason;
}

/** Lets the toast's "view" button open the menu on the archive. */
interface ArchiveReveal {
  subscribeReveal: (listener: () => void) => () => void;
  takeReveal: () => boolean;
}

interface Props {
  mode?: 'switch' | 'compare';
  items: readonly DockTabSwitcherItem[];
  activeTabId: string | null;
  splitTabIds?: readonly string[];
  onActivate: (id: string) => void;
  onClose?: (id: string) => void;
  /** Archived web tabs, newest first; offsets index this list. */
  archived?: readonly DockArchivedSwitcherItem[];
  onReopen?: (offset: number) => void;
  onRemoveArchived?: (offset: number) => void;
  onClearArchive?: () => void;
  reveal?: ArchiveReveal;
  /** Persisted last-use times, so the order survives a restart. */
  lastActiveAt?: Readonly<Record<string, number>>;
  /** Read when the menu renders, so tabs that went stale while idle count. */
  getInactiveCount?: () => number;
  onCloseInactive?: () => void;
}

export const DockTabSwitcher = ({
  mode = 'switch', items, activeTabId, splitTabIds, onActivate, onClose,
  archived = [], onReopen, onRemoveArchived, onClearArchive, reveal,
  lastActiveAt = {}, getInactiveCount, onCloseInactive,
}: Props) => {
  const { t, language } = useI18n();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [recent, setRecent] = useState<string[]>([]);
  const [showAllArchived, setShowAllArchived] = useState(false);
  const openCount = useRef(items.length);
  openCount.current = items.length;
  useGuestInteractionShield(open);
  useEffect(() => {
    if (!reveal) return;
    const show = () => {
      if (!reveal.takeReveal()) return;
      // Select the first archived row; with no query every open tab is listed above it.
      setQuery(''); setSelected(openCount.current); setShowAllArchived(false); setOpen(true);
    };
    show();
    return reveal.subscribeReveal(show);
  }, [reveal]);
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
    return rank(a.id) - rank(b.id) || (lastActiveAt[b.id] ?? 0) - (lastActiveAt[a.id] ?? 0);
  });
  const archivedMatches = archived.flatMap((entry, closedIndex) => filterDockTabs([entry.item], query).length ? [{ ...entry, closedIndex }] : []);
  const archivedShown = query || showAllArchived ? archivedMatches : archivedMatches.slice(0, ARCHIVE_PREVIEW_COUNT);
  const rows = [
    ...filterDockTabs(ordered, query).map(item => ({ item, closedIndex: -1, archivedEntry: undefined })),
    ...archivedShown.map(entry => ({ item: entry.item, closedIndex: entry.closedIndex, archivedEntry: entry })),
  ];
  const focusSearch = () => searchRef.current?.querySelector('input')?.focus();
  const archivedDetail = ({ item, reason, closedAt }: DockArchivedSwitcherItem) => [
    item.url ? dockTabDomain(item.url) : '',
    t(`rightDock.archive.reason.${reason}`),
    formatRelativeTime(closedAt, language),
  ].filter(Boolean).join(' · ');
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
  const comparing = mode === 'compare';
  const inactiveCount = open && !comparing ? getInactiveCount?.() ?? 0 : 0;
  const title = t(comparing ? 'rightDock.chooseComparison' : 'rightDock.allTabs');
  return (
    <>
      <Button ref={triggerRef} size="sm" variant={comparing ? 'icon' : 'secondary'}
        className={comparing ? 'right-dock__split-toggle right-dock__comparison-trigger' : 'right-dock__tab-search-trigger'}
        aria-label={title} title={title} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => { setQuery(''); setSelected(0); setShowAllArchived(false); setOpen(value => !value); }}>
        {comparing ? <Columns size={16} /> : <>{t('rightDock.tabCount', { count: items.length })}<CaretDown size={12} /></>}
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
            {rows.map(({ item, closedIndex, archivedEntry }, index) => (
              <div key={`${closedIndex}:${item.id}`}>
                {index === 0 && closedIndex < 0 && (
                  <div className="right-dock__tab-search-heading">{t(comparing ? 'rightDock.chooseComparison' : 'rightDock.recentTabs')}</div>
                )}
                {closedIndex >= 0 && (index === 0 || rows[index - 1].closedIndex < 0) && (
                  <div className="right-dock__tab-search-heading right-dock__tab-search-heading--archive">
                    <span>{t('rightDock.archived', { count: archived.length })}</span>
                    {onClearArchive && (
                      <Button size="sm" className="right-dock__tab-search-clear"
                        onClick={() => { onClearArchive(); focusSearch(); }}>
                        {t('rightDock.archive.clear')}
                      </Button>
                    )}
                  </div>
                )}
                <div className={`right-dock__tab-search-entry${(!comparing && closedIndex < 0 && item.kind === 'link' && onClose) || (closedIndex >= 0 && onRemoveArchived) ? ' right-dock__tab-search-entry--closable' : ''}`}>
                  <Button id={`${listId}-${index}`} size="sm" role="option" aria-selected={index === currentIndex}
                    className="right-dock__tab-search-row" title={item.url || item.title}
                    onMouseEnter={() => setSelected(index)} onClick={() => choose(index)}>
                    {item.kind === 'terminal' && item.agentType
                      ? <DockAgentTabIcon agentType={item.agentType} />
                      : <DockTabIcon kind={item.kind} faviconUrl={item.faviconUrl} />}
                    <span className="right-dock__tab-search-label"><strong>{item.title}</strong>
                      {archivedEntry
                        ? <small>{archivedDetail(archivedEntry)}</small>
                        : item.url && <small>{dockTabDomain(item.url)}</small>}</span>
                    {closedIndex < 0 && splitTabIds?.includes(item.id) && (
                      <span className="right-dock__tab-position">{t(splitTabIds?.[1] === item.id ? 'rightDock.rightPane' : 'rightDock.leftPane')}</span>
                    )}
                  </Button>
                  {!comparing && closedIndex < 0 && item.kind === 'link' && onClose && (
                    <Button size="sm" variant="icon" className="right-dock__tab-search-close"
                      aria-label={t('rightDock.closeTab', { title: item.title })}
                      title={t('rightDock.closeTab', { title: item.title })}
                      onClick={event => {
                        event.stopPropagation();
                        onClose(item.id);
                        focusSearch();
                      }}><X size={14} /></Button>
                  )}
                  {closedIndex >= 0 && onRemoveArchived && (
                    <Button size="sm" variant="icon" className="right-dock__tab-search-close"
                      aria-label={t('rightDock.archive.remove', { title: item.title })}
                      title={t('rightDock.archive.remove', { title: item.title })}
                      onClick={event => {
                        event.stopPropagation();
                        onRemoveArchived(closedIndex);
                        focusSearch();
                      }}><X size={14} /></Button>
                  )}
                </div>
              </div>
            ))}
            {archivedShown.length < archivedMatches.length && (
              <Button size="sm" className="right-dock__tab-search-show-all"
                onClick={() => { setShowAllArchived(true); focusSearch(); }}>
                {t('rightDock.archive.showAll', { count: archivedMatches.length })}
              </Button>
            )}
          </div>
          {!comparing && !query && inactiveCount > 0 && onCloseInactive && (
            <Button size="sm" className="right-dock__tab-search-cleanup"
              onClick={() => { onCloseInactive(); focusSearch(); }}>
              {t('rightDock.closeIdleTabs', { count: inactiveCount })}
            </Button>
          )}
          {!rows.length && <p role="status" className="right-dock__tab-search-empty">{t(comparing && !items.length ? 'rightDock.openTabToCompare' : 'rightDock.noMatchingTabs')}</p>}
        </Popover>
      )}
    </>
  );
};
