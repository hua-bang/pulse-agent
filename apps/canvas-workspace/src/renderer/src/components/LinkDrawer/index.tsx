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

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n";
import { useEmbeddedBrowser } from '../EmbeddedBrowser/useEmbeddedBrowser';
import { BrowserNavigationButtons } from '../EmbeddedBrowser/BrowserNavigationButtons';
import { useManagedWebviewMount } from '../IframeNodeBody/useManagedWebviewMount';
import { pickFaviconUrl } from "../IframeNodeBody/utils";
import { normalizeUrl } from "../IframeNodeBody/utils";
import { Button, TextField } from "../ui";
import "./index.css";

interface LinkTabViewProps {
  isActive: boolean;
  residencyId: string;
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

export const LinkTabView = ({
  isActive,
  residencyId,
  url,
  activeWorkspaceId,
  onTitleChange,
  onFaviconChange,
  onNavigate,
  onRequestClose,
}: LinkTabViewProps) => {
  const { t } = useI18n();
  const addressFormRef = useRef<HTMLFormElement>(null);
  const webviewHostRef = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState(url);
  const lifecycle = useManagedWebviewMount({
    enabled: true,
    nodeId: `right-dock:${residencyId}`,
    protectedState: isActive,
    url,
    webviewHostRef,
  });
  const browser = useEmbeddedBrowser({
    className: 'link-drawer__webview',
    enabled: lifecycle.shouldMount,
    hostRef: webviewHostRef,
    onFaviconChange: (favicons) => {
      const favicon = pickFaviconUrl(favicons);
      if (favicon) onFaviconChange?.(favicon);
    },
    onNavigate: setAddress,
    onTitleChange,
    url: lifecycle.mountUrl,
  });

  useEffect(() => {
    lifecycle.setCurrentWebview(browser.webview);
    return () => lifecycle.setCurrentWebview(null);
  }, [browser.webview, lifecycle.setCurrentWebview]);

  // Keep the editable address synchronized with external tab navigation;
  // EmbeddedBrowser owns the Electron guest lifecycle and in-page updates.
  useEffect(() => {
    setAddress(url);
    if (!url) requestAnimationFrame(() => addressFormRef.current?.querySelector('input')?.focus());
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
    if (!browser.currentUrl) return;
    void window.canvasWorkspace.shell.openExternal(browser.currentUrl);
  }, [browser.currentUrl]);

  const handleAddToCanvas = useCallback(() => {
    if (!browser.currentUrl || !activeWorkspaceId) return;
    // Cross-component event handed off to the active Canvas. Going through
    // a window event keeps the dock decoupled from the canvas internals;
    // the matching listener lives in components/Canvas/index.tsx.
    window.dispatchEvent(
      new CustomEvent("canvas:add-iframe-from-url", {
        detail: { workspaceId: activeWorkspaceId, url: browser.currentUrl },
      }),
    );
    onRequestClose();
  }, [browser.currentUrl, activeWorkspaceId, onRequestClose]);

  return (
    <>
      <header className="link-drawer__header">
        <BrowserNavigationButtons
          canGoBack={browser.canGoBack}
          canGoForward={browser.canGoForward}
          onBack={browser.goBack}
          onForward={browser.goForward}
          onReload={browser.reload}
        />
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
      <div
        ref={webviewHostRef}
        className="link-drawer__webview-host"
        data-webview-node-id={`right-dock:${residencyId}`}
        data-webview-lifecycle={lifecycle.state}
      />
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
          disabled={!activeWorkspaceId || !browser.currentUrl}
          title={activeWorkspaceId ? undefined : t('linkDrawer.noActiveCanvas')}
        >
          {t('linkDrawer.addToCanvas')}
        </button>
      </footer>
    </>
  );
};
