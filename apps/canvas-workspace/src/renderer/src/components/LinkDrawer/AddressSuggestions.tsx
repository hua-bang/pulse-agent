/**
 * Address-bar history suggestions for LinkTabView — the omnibox dropdown.
 *
 * `useAddressSuggestions` debounce-queries the main-process browsing history
 * (`window.canvasWorkspace.history.search`) with whatever is typed in the
 * address bar (empty input → most recent pages), and maps entries into
 * display rows: search-result pages of the supported engines (see
 * `parseSearchQuery`) surface as the search they were — query text plus a
 * "Search" badge — instead of a raw URL.
 *
 * `AddressSuggestionList` is the listbox; selection state (active index,
 * keyboard nav) stays in LinkTabView, which owns the combobox input —
 * mirroring the RightDock/NodeDockPicker pattern (TextField as combobox +
 * ui/Button option rows; no hand-rolled buttons or dropdown shells).
 */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui';
import { useI18n } from '../../i18n';
import { parseSearchQuery } from '../EmbeddedBrowser/address-input';
import { LinkTabIcon } from '../RightDock/LinkTabIcon';
import type { BrowsingHistoryEntry } from '../../types';

export interface AddressSuggestion {
  url: string;
  /** Primary row text: the search query, the page title, or the URL. */
  label: string;
  /** Secondary row text: hostname for searches, full URL for pages. */
  detail: string;
  faviconUrl?: string;
  isSearch: boolean;
}

export const MAX_SUGGESTIONS = 8;
const DEBOUNCE_MS = 120;

export function toAddressSuggestion(entry: BrowsingHistoryEntry): AddressSuggestion {
  const parsed = parseSearchQuery(entry.url);
  if (parsed) {
    let host = '';
    try {
      host = new URL(entry.url).hostname;
    } catch {
      /* keep empty detail */
    }
    return {
      url: entry.url,
      label: parsed.query,
      detail: host,
      ...(entry.faviconUrl ? { faviconUrl: entry.faviconUrl } : {}),
      isSearch: true,
    };
  }
  return {
    url: entry.url,
    label: entry.title || entry.url,
    detail: entry.url,
    ...(entry.faviconUrl ? { faviconUrl: entry.faviconUrl } : {}),
    isSearch: false,
  };
}

/**
 * Debounced browsing-history lookup for the current address-bar input.
 * Returns [] while disabled; a stale response never overwrites a newer one.
 */
export function useAddressSuggestions(query: string, enabled: boolean): AddressSuggestion[] {
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setSuggestions([]);
      return;
    }
    const seq = ++seqRef.current;
    const timer = window.setTimeout(() => {
      window.canvasWorkspace.history
        .search(query.trim(), MAX_SUGGESTIONS)
        .then((entries) => {
          if (seqRef.current !== seq) return;
          setSuggestions(Array.isArray(entries) ? entries.map(toAddressSuggestion) : []);
        })
        .catch(() => {
          if (seqRef.current === seq) setSuggestions([]);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [query, enabled]);

  return suggestions;
}

interface ListProps {
  suggestions: AddressSuggestion[];
  activeIndex: number;
  /** Panel id the input's aria-controls points at; also prefixes option ids
   *  (unique per tab — several LinkTabViews stay mounted in hidden panes). */
  listId: string;
  onPick: (suggestion: AddressSuggestion) => void;
  onHover: (index: number) => void;
}

export const AddressSuggestionList = ({ suggestions, activeIndex, listId, onPick, onHover }: ListProps) => {
  const { t } = useI18n();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-suggestion-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  return (
    <div
      id={listId}
      ref={listRef}
      className="link-drawer__suggestions"
      role="listbox"
      aria-label={t('linkDrawer.suggestionsAria')}
    >
      {suggestions.map((suggestion, index) => (
        <Button
          key={`${suggestion.url}:${index}`}
          id={`${listId}-option-${index}`}
          variant="secondary"
          size="sm"
          role="option"
          aria-selected={index === activeIndex}
          data-suggestion-index={index}
          className={`link-drawer__suggestion${index === activeIndex ? ' link-drawer__suggestion--active' : ''}`}
          onMouseEnter={() => onHover(index)}
          // Keep focus (and the in-progress selection) in the address input
          // while clicking a row — the click handler does the navigation.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(suggestion)}
        >
          <span className="link-drawer__suggestion-icon">
            <LinkTabIcon faviconUrl={suggestion.faviconUrl} />
          </span>
          <span className="link-drawer__suggestion-copy">
            <strong>{suggestion.label}</strong>
            <small>{suggestion.detail}</small>
          </span>
          {suggestion.isSearch && (
            <span className="link-drawer__suggestion-badge">{t('linkDrawer.suggestionSearchBadge')}</span>
          )}
        </Button>
      ))}
    </div>
  );
};
