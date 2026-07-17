/**
 * Address-bar input resolution for embedded web tabs: decide whether the
 * user typed a URL (navigate) or a search query (send to a search engine),
 * mirroring browser omnibox behavior.
 *
 * Search-engine choice: Google by default; changed in Settings → Browser
 * (persisted to localStorage under `STORAGE_KEY`). Unknown stored values
 * (e.g. an engine that was later removed) fall back to the default.
 */
import { BLANK_PAGE_URL, normalizeUrl } from '../IframeNodeBody/utils';

export const SEARCH_ENGINES = {
  google: {
    label: 'Google',
    buildSearchUrl: (query: string) => `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  },
  bing: {
    label: 'Bing',
    buildSearchUrl: (query: string) => `https://www.bing.com/search?q=${encodeURIComponent(query)}`,
  },
  duckduckgo: {
    label: 'DuckDuckGo',
    buildSearchUrl: (query: string) => `https://duckduckgo.com/?q=${encodeURIComponent(query)}`,
  },
} as const satisfies Record<string, { label: string; buildSearchUrl: (query: string) => string }>;

export type SearchEngineId = keyof typeof SEARCH_ENGINES;

export const DEFAULT_SEARCH_ENGINE: SearchEngineId = 'google';
export const STORAGE_KEY = 'canvas-workspace:default-search-engine';

export function getStoredSearchEngine(): SearchEngineId {
  if (typeof window === 'undefined') return DEFAULT_SEARCH_ENGINE;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && stored in SEARCH_ENGINES) return stored as SearchEngineId;
  } catch {
    /* localStorage unavailable → default */
  }
  return DEFAULT_SEARCH_ENGINE;
}

/** Persist the engine choice (Settings → Browser). Read back lazily at each
 *  address-bar submit, so open tabs pick it up without any live re-render. */
export function setStoredSearchEngine(engine: SearchEngineId): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, engine);
  } catch {
    /* localStorage unavailable → the choice simply won't persist */
  }
}

/**
 * Omnibox-style URL detection. Deliberately conservative about schemes: only
 * explicit `scheme://` (or protocol-relative `//`) counts, so `javascript:`
 * and friends never navigate — matching `normalizeUrl`'s existing stance.
 */
export function looksLikeUrl(input: string): boolean {
  const value = input.trim();
  if (!value || /\s/.test(value)) return false;
  const lowered = value.toLowerCase();
  if (lowered === 'blank' || lowered === BLANK_PAGE_URL) return true;
  // Same scheme shape normalizeUrl passes through, so both stay in agreement.
  if (/^[a-z]+:\/\//i.test(value)) return true;
  if (value.startsWith('//')) return true;
  const authority = value.split(/[/?#]/)[0];
  const hostname = authority.split(':')[0];
  if (!hostname) return false;
  if (hostname.toLowerCase() === 'localhost') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // Domain-ish: dot-separated non-empty labels ("example.com", "sub.a.io").
  return /^[^.\s]+(\.[^.\s]+)+$/.test(hostname);
}

/**
 * Resolve raw address-bar input into a navigable URL: URLs are normalized
 * (https:// prepended when schemeless), everything else becomes a search on
 * the given engine. Empty input resolves to ''.
 */
export function resolveAddressInput(
  rawInput: string,
  engine: SearchEngineId = getStoredSearchEngine(),
): string {
  const value = rawInput.trim();
  if (!value) return '';
  return looksLikeUrl(value)
    ? normalizeUrl(value)
    : SEARCH_ENGINES[engine].buildSearchUrl(value);
}
