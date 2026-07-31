/**
 * Address-bar state for a web tab: the editable value, the omnibox history
 * dropdown, and the rules that decide when guest navigation may overwrite
 * what the user typed.
 *
 * Split out of `LinkTabView` so the browsing chrome stays readable and the
 * editing rules are testable on their own.
 */
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { resolveAddressInput } from '../EmbeddedBrowser/address-input';
import { useAddressSuggestions, type AddressSuggestion } from './AddressSuggestions';
import { useClickOutside } from '../../hooks/useClickOutside';
import { useGuestInteractionShield } from '../../hooks/useGuestInteractionShield';
import { clampIndexMove } from '../ui';
import { cancelDockPageFocusRequest } from '../RightDock/dock-browser-commands';

const SUGGEST_HOVER_CLOSE_DELAY_MS = 200;

interface Options {
  /** Only the visible owner may focus chrome or hold a guest shield. */
  active: boolean;
  /** The tab's committed URL (guest navigation is mirrored into it). */
  url: string;
  /** The guest's live URL, used to tell "untouched" input from a real query. */
  currentUrl: string;
  onNavigate: (url: string) => void;
  onRestorePageFocus: () => void;
}

export const useAddressBar = ({
  active,
  url,
  currentUrl,
  onNavigate,
  onRestorePageFocus,
}: Options) => {
  const formRef = useRef<HTMLFormElement>(null);
  const [address, setAddress] = useState(url);
  const [editing, setEditing] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const suggestionsId = useId();

  const inputEl = useCallback(
    () => formRef.current?.querySelector('input') ?? null,
    [],
  );
  const focusAddress = useCallback(() => {
    if (!active) return;
    cancelDockPageFocusRequest();
    const input = inputEl();
    input?.focus();
    input?.select();
  }, [active, inputEl]);

  // Keep the editable address synchronized with external tab navigation —
  // but never while the user is typing in it. A page that redirects (or an
  // SPA that pushState-navigates) mid-edit used to wipe the half-typed
  // address out from under the cursor.
  useEffect(() => {
    if (editing) return;
    setAddress(url);
  }, [url, editing]);

  // Focus a new blank tab, or a blank tab the user has just activated. This
  // intentionally does NOT depend on `editing`: blurring the omnibox must let
  // keyboard focus move elsewhere instead of scheduling an immediate steal.
  useEffect(() => {
    if (!active || url) return;
    const frame = requestAnimationFrame(focusAddress);
    return () => cancelAnimationFrame(frame);
  }, [active, focusAddress, url]);

  // ── Suggestion dropdown (omnibox history) ─────────────────────────
  const suggestCloseTimerRef = useRef<number | null>(null);
  const cancelScheduledSuggestClose = useCallback(() => {
    if (suggestCloseTimerRef.current !== null) {
      window.clearTimeout(suggestCloseTimerRef.current);
      suggestCloseTimerRef.current = null;
    }
  }, []);
  const scheduleSuggestClose = useCallback(() => {
    cancelScheduledSuggestClose();
    suggestCloseTimerRef.current = window.setTimeout(() => {
      suggestCloseTimerRef.current = null;
      setSuggestOpen(false);
    }, SUGGEST_HOVER_CLOSE_DELAY_MS);
  }, [cancelScheduledSuggestClose]);
  useEffect(() => cancelScheduledSuggestClose, [cancelScheduledSuggestClose]);

  useEffect(() => {
    if (active) return;
    cancelScheduledSuggestClose();
    setSuggestOpen(false);
    setEditing(false);
    setActiveSuggestion(-1);
    const input = inputEl();
    if (document.activeElement === input) input?.blur();
  }, [active, cancelScheduledSuggestClose, inputEl]);

  // Untouched input still holding the current page's URL (the just-focused
  // state — focus selects it all) means "show me recent pages", not "filter
  // by this URL"; anything the user actually typed filters.
  const effectiveQuery = address.trim() === (currentUrl || url).trim() ? '' : address;
  const suggestions = useAddressSuggestions(effectiveQuery, suggestOpen);
  useEffect(() => setActiveSuggestion(-1), [address]);
  useClickOutside(formRef, () => setSuggestOpen(false), suggestOpen);
  const suggestionsVisible = active && suggestOpen && suggestions.length > 0;
  // The dropdown floats above the page. Without the shield a click into the
  // page is swallowed by the guest process, `useClickOutside` never fires,
  // and the list stays stranded on top of whatever the user clicked.
  useGuestInteractionShield(suggestionsVisible);

  /** Hand focus back to the page: the address bar is done with this input. */
  const commit = useCallback((nextUrl: string) => {
    setSuggestOpen(false);
    setEditing(false);
    inputEl()?.blur();
    onNavigate(nextUrl);
    onRestorePageFocus();
  }, [inputEl, onNavigate, onRestorePageFocus]);

  const pickSuggestion = useCallback((suggestion: AddressSuggestion) => {
    commit(suggestion.url);
  }, [commit]);

  const onSubmit = useCallback((event: FormEvent) => {
    event.preventDefault();
    // Omnibox behavior: URL-ish input navigates, anything else searches on
    // the configured engine (Google by default) — see address-input.ts.
    const nextUrl = resolveAddressInput(address);
    if (nextUrl) commit(nextUrl);
    else setSuggestOpen(false);
  }, [address, commit]);

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      // Swallow it — the RightDock window listener would otherwise act on it.
      event.preventDefault();
      event.stopPropagation();
      if (suggestionsVisible) {
        setSuggestOpen(false);
        return;
      }
      // Second Escape: abandon the edit and restore the live URL.
      setSuggestOpen(false);
      setEditing(false);
      setAddress(url);
      inputEl()?.blur();
      onRestorePageFocus();
      return;
    }
    if (!suggestionsVisible) return;
    // Shift the [-1, n-1] selection domain (with -1 = the typed input) onto
    // clampIndexMove's [0, n] so the shared clamp semantics apply.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveSuggestion((current) => clampIndexMove(current + 1, delta, suggestions.length + 1) - 1);
      return;
    }
    if (event.key === 'Enter' && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
      event.preventDefault();
      pickSuggestion(suggestions[activeSuggestion]);
    }
  }, [
    activeSuggestion,
    inputEl,
    onRestorePageFocus,
    pickSuggestion,
    suggestions,
    suggestionsVisible,
    url,
  ]);

  const onChange = useCallback((value: string) => {
    setAddress(value);
    setEditing(true);
    setSuggestOpen(true);
  }, []);

  const onFocus = useCallback((input: HTMLInputElement) => {
    if (!active) {
      input.blur();
      return;
    }
    cancelDockPageFocusRequest();
    input.select();
    setEditing(true);
    setSuggestOpen(true);
  }, [active]);

  // Leaving the field ends the edit; the sync effect then re-adopts whatever
  // the guest navigated to while the user was typing.
  const onBlur = useCallback(() => {
    setEditing(false);
    setSuggestOpen(false);
  }, []);

  return {
    activeSuggestion,
    address,
    focusAddress,
    formRef,
    onBlur,
    onChange,
    onFocus,
    onKeyDown,
    onSubmit,
    pickSuggestion,
    setActiveSuggestion,
    suggestions,
    suggestionsId,
    suggestionsVisible,
    cancelScheduledSuggestClose,
    scheduleSuggestClose,
  };
};
