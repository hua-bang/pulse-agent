/**
 * Right-dock tab content for external links intercepted from embedded
 * webviews and sandboxed iframes. Each open link preview owns its own
 * <webview>; the dock dedupes exact URLs while allowing different links
 * to stay open side by side.
 *
 * Tab chrome and switching live in components/RightDock; link actions live
 * beside the address bar, and the resolved page title is reported up via
 * `onTitleChange`.
 */

import { useCallback, useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useI18n } from "../../i18n";
import { useEmbeddedBrowser } from '../EmbeddedBrowser/useEmbeddedBrowser';
import { BrowserNavigationButtons } from '../EmbeddedBrowser/BrowserNavigationButtons';
import { resolveAddressInput } from '../EmbeddedBrowser/address-input';
import { AddressSuggestionList, useAddressSuggestions, type AddressSuggestion } from './AddressSuggestions';
import { useWebviewRegistration } from '../IframeNodeBody/useWebviewRegistration';
import { useClickOutside } from '../../hooks/useClickOutside';
import { pickFaviconUrl } from "../IframeNodeBody/utils";
import { ExternalLinkIcon, PlusIcon } from "../icons";
import { Button, TextField, clampIndexMove } from "../ui";
import { EXPERIMENTAL_FLAG_DEFAULT_BROWSER } from "../../../../shared/experimental-features";
import "./index.css";

/** Google blocks account sign-in inside embedded browsers (WebView policy);
 *  detect its sign-in host so we can steer the user to the system browser. */
function isGoogleAuthUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    return new URL(raw).hostname === 'accounts.google.com';
  } catch {
    return false;
  }
}

interface LinkTabViewProps {
  url: string;
  title?: string;
  /** Dock tab id — used as the webview registry key so the Canvas Agent can
   *  read this tab's live page via `canvas_read_tab`. */
  tabId?: string;
  onActivate?: () => void;
  onTitleChange?: (title: string) => void;
  /** Page favicon, reported once the webview resolves it, so the tab icon
   *  follows the site instead of a hardcoded globe. */
  onFaviconChange?: (faviconUrl: string) => void;
  /** Navigate this tab while preserving its stable tab identity. */
  onNavigate: (url: string) => void;
  /** Mirror a guest navigation without resetting a resolved page title. */
  onGuestNavigate: (url: string) => void;
  onAddToReference: (url: string, title?: string) => void;
  activeWorkspaceId: string;
  onRequestClose: () => void;
}

export const LinkTabView = ({
  url,
  title,
  tabId,
  onActivate,
  onTitleChange,
  onFaviconChange,
  onNavigate,
  onGuestNavigate,
  onAddToReference,
  activeWorkspaceId,
  onRequestClose,
}: LinkTabViewProps) => {
  const { t } = useI18n();
  const addressFormRef = useRef<HTMLFormElement>(null);
  const [address, setAddress] = useState(url);
  // When Pulse Canvas is itself the default browser, the "open in system
  // browser" escape hatch loops back into this app — so steer the user to
  // disable the flag instead. Snapshotted at preload; a reload picks up changes.
  const isDefaultBrowser =
    window.canvasWorkspace.pluginFlags?.[EXPERIMENTAL_FLAG_DEFAULT_BROWSER] === true;
  // Last main-frame URL this tab navigated to — the key under which late
  // title/favicon events are folded into the same browsing-history visit.
  const lastVisitedUrlRef = useRef('');
  const browser = useEmbeddedBrowser({
    className: 'link-drawer__webview',
    onFocus: onActivate,
    onFaviconChange: (favicons) => {
      const favicon = pickFaviconUrl(favicons);
      if (!favicon) return;
      onFaviconChange?.(favicon);
      if (lastVisitedUrlRef.current) {
        window.canvasWorkspace.history.record({ url: lastVisitedUrlRef.current, faviconUrl: favicon });
      }
    },
    onNavigate: (nextUrl) => {
      setAddress(nextUrl);
      lastVisitedUrlRef.current = nextUrl;
      onGuestNavigate(nextUrl);
      window.canvasWorkspace.history.record({ url: nextUrl });
    },
    onTitleChange: (title) => {
      onTitleChange?.(title);
      if (lastVisitedUrlRef.current) {
        window.canvasWorkspace.history.record({ url: lastVisitedUrlRef.current, title });
      }
    },
    url,
  });

  // Register this tab's <webview> with main so the Canvas Agent can read the
  // live page (via canvas_read_tab), keyed by the dock tab id. Reuses the same
  // registry + lifecycle plumbing as iframe canvas nodes.
  useWebviewRegistration({
    webview: browser.webview,
    workspaceId: activeWorkspaceId,
    nodeId: tabId ?? '',
    enabled: Boolean(tabId && activeWorkspaceId),
  });

  // Keep the editable address synchronized with external tab navigation;
  // EmbeddedBrowser owns the Electron guest lifecycle and in-page updates.
  useEffect(() => {
    setAddress(url);
    if (!url) requestAnimationFrame(() => addressFormRef.current?.querySelector('input')?.focus());
  }, [url]);

  // ── Address-bar history suggestions (omnibox dropdown) ────────────
  // Open while the input is focused/edited; -1 = no row selected (Enter
  // resolves the typed text as usual). ArrowDown/Up move through rows and
  // back up to the raw input; Escape and outside presses dismiss.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  // Untouched input still holding the current page's URL (the just-focused
  // state — onFocus selects it all) means "show me recent pages", not
  // "filter by this URL"; anything the user actually typed filters.
  const effectiveQuery = address.trim() === (browser.currentUrl || url).trim() ? '' : address;
  const suggestions = useAddressSuggestions(effectiveQuery, suggestOpen);
  const suggestionsId = useId();
  useEffect(() => setActiveSuggestion(-1), [address]);
  useClickOutside(addressFormRef, () => setSuggestOpen(false), suggestOpen);
  const suggestionsVisible = suggestOpen && suggestions.length > 0;

  const pickSuggestion = useCallback((suggestion: AddressSuggestion) => {
    setSuggestOpen(false);
    onNavigate(suggestion.url);
  }, [onNavigate]);

  const handleAddressKeyDown = useCallback((event: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestionsVisible) return;
    // Shift the [-1, n-1] selection domain (with -1 = the typed input) onto
    // clampIndexMove's [0, n] so the shared clamp semantics apply.
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveSuggestion((current) => clampIndexMove(current + 1, delta, suggestions.length + 1) - 1);
      return;
    }
    if (event.key === 'Escape') {
      // Swallow it — the RightDock window listener closes the tab on Escape.
      event.preventDefault();
      event.stopPropagation();
      setSuggestOpen(false);
      return;
    }
    if (event.key === 'Enter' && activeSuggestion >= 0 && suggestions[activeSuggestion]) {
      event.preventDefault();
      pickSuggestion(suggestions[activeSuggestion]);
    }
  }, [suggestionsVisible, suggestions, activeSuggestion, pickSuggestion]);

  const handleNavigate = useCallback((event: FormEvent) => {
    event.preventDefault();
    setSuggestOpen(false);
    // Omnibox behavior: URL-ish input navigates, anything else searches on
    // the configured engine (Google by default) — see address-input.ts.
    const nextUrl = resolveAddressInput(address);
    if (nextUrl) onNavigate(nextUrl);
  }, [address, onNavigate]);

  const handleOpenInBrowser = useCallback(() => {
    if (!browser.currentUrl) return;
    void window.canvasWorkspace.shell.openExternal(browser.currentUrl);
  }, [browser.currentUrl]);

  const handleAddToCanvas = useCallback(() => {
    if (!browser.currentUrl || !activeWorkspaceId) return;
    window.dispatchEvent(
      new CustomEvent('canvas:add-iframe-from-url', {
        detail: { workspaceId: activeWorkspaceId, url: browser.currentUrl },
      }),
    );
    onRequestClose();
  }, [browser.currentUrl, activeWorkspaceId, onRequestClose]);

  const handleAddToReference = useCallback(() => {
    if (!browser.currentUrl) return;
    onAddToReference(browser.currentUrl, title);
  }, [browser.currentUrl, onAddToReference, title]);

  return (
    <>
      <header className="link-drawer__header">
        <BrowserNavigationButtons
          canGoBack={browser.canGoBack}
          canGoForward={browser.canGoForward}
          onBack={browser.goBack}
          onForward={browser.goForward}
          onReload={browser.reload}
          loading={browser.loadState === 'loading'}
        />
        <form
          ref={addressFormRef}
          className="link-drawer__address-form"
          onFocus={onActivate}
          onSubmit={handleNavigate}
        >
          <TextField
            className="link-drawer__url"
            value={address}
            onChange={(event) => {
              setAddress(event.target.value);
              setSuggestOpen(true);
            }}
            onFocus={(event) => {
              event.currentTarget.select();
              setSuggestOpen(true);
            }}
            onKeyDown={handleAddressKeyDown}
            placeholder={t('linkDrawer.addressPlaceholder')}
            aria-label={t('linkDrawer.addressLabel')}
            spellCheck={false}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={suggestionsVisible}
            aria-controls={suggestionsVisible ? suggestionsId : undefined}
            aria-activedescendant={
              suggestionsVisible && activeSuggestion >= 0
                ? `${suggestionsId}-option-${activeSuggestion}`
                : undefined
            }
          />
          {suggestionsVisible && (
            <AddressSuggestionList
              suggestions={suggestions}
              activeIndex={activeSuggestion}
              listId={suggestionsId}
              onPick={pickSuggestion}
              onHover={setActiveSuggestion}
            />
          )}
        </form>
        <div className="link-drawer__actions">
          <Button
            variant="icon"
            size="xs"
            className="link-drawer__action"
            aria-label={t('linkDrawer.addToReference')}
            title={t('linkDrawer.addToReference')}
            onClick={handleAddToReference}
            disabled={!browser.currentUrl}
          >
            <ReferenceIcon />
          </Button>
          <Button
            variant="icon"
            size="xs"
            className="link-drawer__action"
            aria-label={t('linkDrawer.openInBrowser')}
            title={t('linkDrawer.openInBrowser')}
            onClick={handleOpenInBrowser}
            disabled={!browser.currentUrl}
          >
            <ExternalLinkIcon />
          </Button>
          <Button
            variant="icon"
            size="xs"
            className="link-drawer__action"
            aria-label={t('linkDrawer.addToCanvas')}
            onClick={handleAddToCanvas}
            disabled={!activeWorkspaceId || !browser.currentUrl}
            title={activeWorkspaceId ? t('linkDrawer.addToCanvas') : t('linkDrawer.noActiveCanvas')}
          >
            <PlusIcon size={12} strokeWidth={1.2} />
          </Button>
        </div>
      </header>
      {browser.loadState === 'loading' && (
        <div
          className="link-drawer__loading-bar"
          role="progressbar"
          aria-label={t('linkDrawer.loadingPage')}
        />
      )}
      {isGoogleAuthUrl(browser.currentUrl) && (
        <div className="link-drawer__auth-notice" role="status">
          {isDefaultBrowser ? (
            // "Open in system browser" would hand the URL back to the default
            // handler — which is Pulse Canvas — and loop straight back into
            // this blocked page. Point the user at the real fix instead.
            <span className="link-drawer__auth-notice-text">
              {t('linkDrawer.googleAuthDefaultBrowser')}
            </span>
          ) : (
            <>
              <span className="link-drawer__auth-notice-text">
                {t('linkDrawer.googleAuthUnsupported')}
              </span>
              <Button
                variant="secondary"
                size="xs"
                onClick={handleOpenInBrowser}
                disabled={!browser.currentUrl}
              >
                {t('linkDrawer.googleAuthOpenExternal')}
              </Button>
            </>
          )}
        </div>
      )}
      <div ref={browser.hostRef} className="link-drawer__webview-host" />
    </>
  );
};

const ReferenceIcon = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
    <path d="M3 1.75h6v8.5L6 8.3l-3 1.95v-8.5z" stroke="currentColor" strokeWidth="1.15" strokeLinejoin="round" />
  </svg>
);
