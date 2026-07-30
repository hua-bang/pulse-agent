/**
 * Find-in-page for a web tab.
 *
 * Chromium owns the search; `webview.findInPage` runs it in the guest and
 * reports progress back on `found-in-page`. The host only holds the query,
 * the match counter, and the open/closed state of the bar.
 *
 * A new query starts a fresh search; next/previous re-issue the SAME query
 * with `findNext`, which is how Chromium distinguishes "search again" from
 * "step through the existing results".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EmbeddedWebviewTag } from '../EmbeddedBrowser/types';

export interface FindMatches {
  active: number;
  total: number;
}

const NO_MATCHES: FindMatches = { active: 0, total: 0 };

export const useFindInPage = (webview: EmbeddedWebviewTag | null) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<FindMatches>(NO_MATCHES);
  // ui/TextField does not forward refs; reach its control through the bar
  // wrapper, the same way the address bar reaches its input through the form.
  const barRef = useRef<HTMLDivElement>(null);
  const inputEl = useCallback(() => barRef.current?.querySelector('input') ?? null, []);

  useEffect(() => {
    if (!webview) return;
    const onFound = (event: Event) => {
      const result = (event as Event & {
        result?: { activeMatchOrdinal?: number; matches?: number };
      }).result;
      if (!result) return;
      setMatches({ active: result.activeMatchOrdinal ?? 0, total: result.matches ?? 0 });
    };
    webview.addEventListener('found-in-page', onFound);
    return () => webview.removeEventListener('found-in-page', onFound);
  }, [webview]);

  const search = useCallback((text: string, options?: { findNext?: boolean; forward?: boolean }) => {
    if (!webview) return;
    if (!text) {
      // An empty box is "no search", not "search for nothing" — Chromium
      // would keep the previous highlight otherwise.
      try {
        webview.stopFindInPage('clearSelection');
      } catch {
        /* guest gone */
      }
      setMatches(NO_MATCHES);
      return;
    }
    try {
      webview.findInPage(text, options);
    } catch {
      setMatches(NO_MATCHES);
    }
  }, [webview]);

  const onQueryChange = useCallback((text: string) => {
    setQuery(text);
    search(text);
  }, [search]);

  const step = useCallback((forward: boolean) => {
    if (!query) return;
    search(query, { findNext: true, forward });
  }, [query, search]);

  const openFind = useCallback(() => {
    setOpen(true);
    // Re-focusing an already-open bar selects the query, so the next
    // keystroke replaces it — the standard find-bar behaviour.
    requestAnimationFrame(() => {
      const input = inputEl();
      input?.focus();
      input?.select();
    });
  }, [inputEl]);

  const close = useCallback(() => {
    setOpen(false);
    setMatches(NO_MATCHES);
    try {
      webview?.stopFindInPage('clearSelection');
    } catch {
      /* guest gone */
    }
  }, [webview]);

  // A tab that navigates away has nothing left to highlight.
  useEffect(() => {
    if (!webview) return;
    const onNavigate = () => setMatches(NO_MATCHES);
    webview.addEventListener('did-navigate', onNavigate);
    return () => webview.removeEventListener('did-navigate', onNavigate);
  }, [webview]);

  return { open, query, matches, barRef, openFind, close, onQueryChange, step };
};
