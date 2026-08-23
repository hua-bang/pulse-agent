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
import { DOCK_FIND_FALLBACK_CHANNEL } from '../../../../../shared/dock-shortcuts';
import type { EmbeddedWebviewTag } from '../EmbeddedBrowser/types';
import { cancelDockPageFocusRequest } from '../RightDock/dock-browser-commands';

export interface FindMatches {
  active: number;
  total: number;
}

const NO_MATCHES: FindMatches = { active: 0, total: 0 };

interface UseFindInPageOptions {
  active?: boolean;
  onRestorePageFocus?: () => void;
}

export const useFindInPage = (
  webview: EmbeddedWebviewTag | null,
  { active = true, onRestorePageFocus }: UseFindInPageOptions = {},
) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<FindMatches>(NO_MATCHES);
  const activeRequestIdRef = useRef<number | null>(null);
  const openRef = useRef(open);
  const queryRef = useRef(query);
  const activeRef = useRef(active);
  const focusFrameRef = useRef<number | null>(null);
  openRef.current = open;
  queryRef.current = query;
  activeRef.current = active;
  // ui/TextField does not forward refs; reach its control through the bar
  // wrapper, the same way the address bar reaches its input through the form.
  const barRef = useRef<HTMLDivElement>(null);
  const inputEl = useCallback(() => barRef.current?.querySelector('input') ?? null, []);

  useEffect(() => {
    activeRequestIdRef.current = null;
    if (!webview) return;
    const onFound = (event: Event) => {
      const result = (event as Event & {
        result?: { requestId?: number; activeMatchOrdinal?: number; matches?: number };
      }).result;
      if (!result || result.requestId !== activeRequestIdRef.current) return;
      setMatches({ active: result.activeMatchOrdinal ?? 0, total: result.matches ?? 0 });
    };
    webview.addEventListener('found-in-page', onFound);
    setMatches(NO_MATCHES);
    if (openRef.current && queryRef.current) {
      try {
        activeRequestIdRef.current = webview.findInPage(queryRef.current, undefined);
      } catch {
        activeRequestIdRef.current = null;
      }
    }
    return () => {
      activeRequestIdRef.current = null;
      webview.removeEventListener('found-in-page', onFound);
    };
  }, [webview]);

  const search = useCallback((text: string, options?: { findNext?: boolean; forward?: boolean }) => {
    if (!webview) return;
    if (!text) {
      activeRequestIdRef.current = null;
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
      activeRequestIdRef.current = webview.findInPage(text, options);
    } catch {
      activeRequestIdRef.current = null;
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
    if (!active) return;
    // Find chrome is the user's newer focus destination. A queued page-focus
    // intent from tab activation must not steal focus when the guest mounts.
    cancelDockPageFocusRequest();
    setOpen(true);
    if (query) search(query);
    // Re-focusing an already-open bar selects the query, so the next
    // keystroke replaces it — the standard find-bar behaviour.
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      if (!activeRef.current) return;
      const input = inputEl();
      input?.focus();
      input?.select();
    });
  }, [active, inputEl, query, search]);

  useEffect(() => {
    if (!webview) return;
    const onGuestMessage = (event: Event) => {
      const channel = (event as Event & { channel?: string }).channel;
      if (channel === DOCK_FIND_FALLBACK_CHANNEL) openFind();
    };
    webview.addEventListener('ipc-message', onGuestMessage);
    return () => webview.removeEventListener('ipc-message', onGuestMessage);
  }, [openFind, webview]);

  useEffect(() => {
    if (active) return;
    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }
  }, [active]);

  useEffect(() => () => {
    if (focusFrameRef.current !== null) cancelAnimationFrame(focusFrameRef.current);
  }, []);

  const close = useCallback(() => {
    activeRequestIdRef.current = null;
    setOpen(false);
    setMatches(NO_MATCHES);
    try {
      webview?.stopFindInPage('clearSelection');
    } catch {
      /* guest gone */
    }
    if (onRestorePageFocus) {
      onRestorePageFocus();
      return;
    }
    try {
      webview?.focus();
    } catch {
      /* guest gone and no owner-provided pending-focus path */
    }
  }, [onRestorePageFocus, webview]);

  // A tab that navigates away has nothing left to highlight.
  useEffect(() => {
    if (!webview) return;
    const onNavigate = () => {
      activeRequestIdRef.current = null;
      setMatches(NO_MATCHES);
    };
    webview.addEventListener('did-navigate', onNavigate);
    return () => webview.removeEventListener('did-navigate', onNavigate);
  }, [webview]);

  return { open, query, matches, barRef, openFind, close, onQueryChange, step };
};
