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

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../i18n";
import { useEmbeddedBrowser } from '../EmbeddedBrowser/useEmbeddedBrowser';
import { BrowserNavigationButtons } from '../EmbeddedBrowser/BrowserNavigationButtons';
import { resolveAddressInput } from '../EmbeddedBrowser/address-input';
import { useWebviewRegistration } from '../IframeNodeBody/useWebviewRegistration';
import { pickFaviconUrl } from "../IframeNodeBody/utils";
import { ExternalLinkIcon, PlusIcon } from "../icons";
import { Button, TextField } from "../ui";
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
  /** Dock tab id — used as the webview registry key so the Canvas Agent can
   *  read this tab's live page via `canvas_read_tab`. */
  tabId?: string;
  onTitleChange?: (title: string) => void;
  /** Page favicon, reported once the webview resolves it, so the tab icon
   *  follows the site instead of a hardcoded globe. */
  onFaviconChange?: (faviconUrl: string) => void;
  /** Navigate this tab while preserving its stable tab identity. */
  onNavigate: (url: string) => void;
  activeWorkspaceId: string;
  onRequestClose: () => void;
}

export const LinkTabView = ({
  url,
  tabId,
  onTitleChange,
  onFaviconChange,
  onNavigate,
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

  const handleNavigate = useCallback((event: FormEvent) => {
    event.preventDefault();
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
        <div className="link-drawer__actions">
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
