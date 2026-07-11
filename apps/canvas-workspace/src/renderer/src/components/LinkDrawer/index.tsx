/**
 * Right-dock tab content for external links intercepted from embedded
 * webviews and sandboxed iframes. Each open link preview owns its own
 * <webview>; the dock dedupes exact URLs while allowing different links
 * to stay open side by side. The view exposes:
 *  - open in system browser (escape hatch for X-Frame-Options-blocked
 *    sites, or when the user wants a real browser tab)
 *  - add to current canvas (creates a new iframe node bound to the URL,
 *    then closes the tab)
 *
 * Tab chrome (label, close, switching) lives in components/RightDock;
 * the resolved page title is reported up via `onTitleChange`.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n";
import { pickFaviconUrl } from "../IframeNodeBody/utils";
import { normalizeUrl } from "../IframeNodeBody/utils";
import { Button, TextField } from "../ui";
import "./index.css";

interface WebviewTag extends HTMLElement {
  getWebContentsId(): number;
  reload(): void;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
}

interface LinkTabViewProps {
  url: string;
  /** Active workspace id, used as the target for "add to current canvas". */
  activeWorkspaceId: string;
  onTitleChange?: (title: string) => void;
  /** Page favicon, reported once the webview resolves it, so the tab icon
   *  follows the site instead of a hardcoded globe. */
  onFaviconChange?: (faviconUrl: string) => void;
  /** Navigate this tab while preserving its stable tab identity. */
  onNavigate: (url: string) => void;
  /** Asks the dock to close this tab (after "add to current canvas"). */
  onRequestClose: () => void;
}

export const LinkTabView = ({ url, activeWorkspaceId, onTitleChange, onFaviconChange, onNavigate, onRequestClose }: LinkTabViewProps) => {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<WebviewTag | null>(null);
  const addressFormRef = useRef<HTMLFormElement>(null);
  const [address, setAddress] = useState(url);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  const onFaviconChangeRef = useRef(onFaviconChange);
  onFaviconChangeRef.current = onFaviconChange;

  // Imperatively mount a fresh `<webview>` whenever the URL changes. The
  // element has to be created off-DOM with `allowpopups` already set,
  // otherwise Electron's `connectedCallback` configures the guest with
  // popups disabled (see IframeNodeBody for the full explanation of the
  // React-18 + Electron timing issue).
  useEffect(() => {
    setAddress(url);
    setCurrentUrl(url);
    if (!url) requestAnimationFrame(() => addressFormRef.current?.querySelector('input')?.focus());
  }, [url]);

  useLayoutEffect(() => {
    if (!url) return;
    const host = hostRef.current;
    if (!host) return;

    const webview = document.createElement("webview") as WebviewTag;
    webview.setAttribute("allowpopups", "");
    webview.setAttribute("src", url);
    webview.className = "link-drawer__webview";
    setCanGoBack(false);
    setCanGoForward(false);
    const syncNavigationState = () => {
      setCanGoBack(webview.canGoBack());
      setCanGoForward(webview.canGoForward());
    };
    const onDidNavigate = (event: Event) => {
      const navigation = event as Event & { url?: string; isMainFrame?: boolean };
      if (navigation.isMainFrame === false) return;
      if (navigation.url) {
        setCurrentUrl(navigation.url);
        setAddress(navigation.url);
      }
      syncNavigationState();
    };
    const onPageTitleUpdated = (event: Event) => {
      const title = (event as Event & { title?: string }).title;
      if (title) onTitleChangeRef.current?.(title);
    };
    const onPageFaviconUpdated = (event: Event) => {
      const favicon = pickFaviconUrl((event as Event & { favicons?: string[] }).favicons);
      if (favicon) onFaviconChangeRef.current?.(favicon);
    };
    webview.addEventListener("page-title-updated", onPageTitleUpdated);
    webview.addEventListener("page-favicon-updated", onPageFaviconUpdated);
    webview.addEventListener("did-navigate", onDidNavigate);
    webview.addEventListener("did-navigate-in-page", onDidNavigate);
    host.appendChild(webview);
    webviewRef.current = webview;

    return () => {
      webview.removeEventListener("page-title-updated", onPageTitleUpdated);
      webview.removeEventListener("page-favicon-updated", onPageFaviconUpdated);
      webview.removeEventListener("did-navigate", onDidNavigate);
      webview.removeEventListener("did-navigate-in-page", onDidNavigate);
      webview.remove();
      if (webviewRef.current === webview) {
        webviewRef.current = null;
      }
    };
  }, [url]);

  const handleNavigate = useCallback((event: FormEvent) => {
    event.preventDefault();
    const value = address.trim();
    if (!value) return;
    const nextUrl = /\s/.test(value)
      ? `https://www.google.com/search?q=${encodeURIComponent(value)}`
      : normalizeUrl(value);
    onNavigate(nextUrl);
  }, [address, onNavigate]);

  const handleOpenInBrowser = useCallback(() => {
    if (!currentUrl) return;
    void window.canvasWorkspace.shell.openExternal(currentUrl);
  }, [currentUrl]);

  const handleAddToCanvas = useCallback(() => {
    if (!currentUrl || !activeWorkspaceId) return;
    // Cross-component event handed off to the active Canvas. Going through
    // a window event keeps the dock decoupled from the canvas internals;
    // the matching listener lives in components/Canvas/index.tsx.
    window.dispatchEvent(
      new CustomEvent("canvas:add-iframe-from-url", {
        detail: { workspaceId: activeWorkspaceId, url: currentUrl },
      }),
    );
    onRequestClose();
  }, [currentUrl, activeWorkspaceId, onRequestClose]);

  const handleGoBack = useCallback(() => {
    if (webviewRef.current?.canGoBack()) webviewRef.current.goBack();
  }, []);

  const handleGoForward = useCallback(() => {
    if (webviewRef.current?.canGoForward()) webviewRef.current.goForward();
  }, []);

  const handleReload = useCallback(() => {
    webviewRef.current?.reload();
  }, []);

  return (
    <>
      <header className="link-drawer__header">
        <Button
          variant="icon"
          onClick={handleGoBack}
          disabled={!canGoBack}
          title={t('linkDrawer.back')}
          aria-label={t('linkDrawer.back')}
        >
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M7.5 2.5L4 6l3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
        <Button
          variant="icon"
          onClick={handleGoForward}
          disabled={!canGoForward}
          title={t('linkDrawer.forward')}
          aria-label={t('linkDrawer.forward')}
        >
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4.5 2.5L8 6l-3.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
        <Button
          variant="icon"
          onClick={handleReload}
          title={t('linkDrawer.reload')}
          aria-label={t('linkDrawer.reload')}
        >
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M2 6a4 4 0 016.9-2.8L10 4M10 2v2.5H7.5M10 6a4 4 0 01-6.9 2.8L2 8M2 10V7.5h2.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Button>
        <form ref={addressFormRef} className="link-drawer__address-form" onSubmit={handleNavigate}>
          <TextField
            className="link-drawer__url"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            onFocus={(event) => event.currentTarget.select()}
            placeholder={t('linkDrawer.addressPlaceholder')}
            aria-label={t('linkDrawer.addressLabel')}
            spellCheck={false}
          />
        </form>
      </header>
      <div ref={hostRef} className="link-drawer__webview-host" />
      <footer className="link-drawer__footer">
        <button
          type="button"
          className="link-drawer__btn"
          onClick={handleOpenInBrowser}
        >
          {t('linkDrawer.openInBrowser')}
        </button>
        <button
          type="button"
          className="link-drawer__btn link-drawer__btn--primary"
          onClick={handleAddToCanvas}
          disabled={!activeWorkspaceId || !currentUrl}
          title={activeWorkspaceId ? undefined : t('linkDrawer.noActiveCanvas')}
        >
          {t('linkDrawer.addToCanvas')}
        </button>
      </footer>
    </>
  );
};
