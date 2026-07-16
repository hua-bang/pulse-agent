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
import { pickFaviconUrl } from "../IframeNodeBody/utils";
import { normalizeUrl } from "../IframeNodeBody/utils";
import { ExternalLinkIcon, PlusIcon } from "../icons";
import { Button, TextField } from "../ui";
import "./index.css";

interface LinkTabViewProps {
  url: string;
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
  onTitleChange,
  onFaviconChange,
  onNavigate,
  activeWorkspaceId,
  onRequestClose,
}: LinkTabViewProps) => {
  const { t } = useI18n();
  const addressFormRef = useRef<HTMLFormElement>(null);
  const [address, setAddress] = useState(url);
  const browser = useEmbeddedBrowser({
    className: 'link-drawer__webview',
    onFaviconChange: (favicons) => {
      const favicon = pickFaviconUrl(favicons);
      if (favicon) onFaviconChange?.(favicon);
    },
    onNavigate: setAddress,
    onTitleChange,
    url,
  });

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
      <div ref={browser.hostRef} className="link-drawer__webview-host" />
    </>
  );
};
