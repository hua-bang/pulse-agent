/**
 * Right-dock tab content for external links intercepted from embedded
 * webviews and sandboxed iframes. Each open link preview owns its own
 * <webview>; the dock dedupes exact URLs while allowing different links
 * to stay open side by side.
 *
 * Tab chrome, link actions (open in browser / add to canvas), and switching
 * live in components/RightDock; the resolved page title is reported up via
 * `onTitleChange`.
 */

import { useCallback, useLayoutEffect, useRef } from "react";
import { useI18n } from "../../i18n";
import { pickFaviconUrl } from "../IframeNodeBody/utils";
import { Button } from "../ui";
import "./index.css";

interface WebviewTag extends HTMLElement {
  getWebContentsId(): number;
  reload(): void;
}

interface LinkTabViewProps {
  url: string;
  onTitleChange?: (title: string) => void;
  /** Page favicon, reported once the webview resolves it, so the tab icon
   *  follows the site instead of a hardcoded globe. */
  onFaviconChange?: (faviconUrl: string) => void;
}

export const LinkTabView = ({ url, onTitleChange, onFaviconChange }: LinkTabViewProps) => {
  const { t } = useI18n();
  const hostRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<WebviewTag | null>(null);
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;
  const onFaviconChangeRef = useRef(onFaviconChange);
  onFaviconChangeRef.current = onFaviconChange;

  // Imperatively mount a fresh `<webview>` whenever the URL changes. The
  // element has to be created off-DOM with `allowpopups` already set,
  // otherwise Electron's `connectedCallback` configures the guest with
  // popups disabled (see IframeNodeBody for the full explanation of the
  // React-18 + Electron timing issue).
  useLayoutEffect(() => {
    if (!url) return;
    const host = hostRef.current;
    if (!host) return;

    const webview = document.createElement("webview") as WebviewTag;
    webview.setAttribute("allowpopups", "");
    webview.setAttribute("src", url);
    webview.className = "link-drawer__webview";
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
    host.appendChild(webview);
    webviewRef.current = webview;

    return () => {
      webview.removeEventListener("page-title-updated", onPageTitleUpdated);
      webview.removeEventListener("page-favicon-updated", onPageFaviconUpdated);
      webview.remove();
      if (webviewRef.current === webview) {
        webviewRef.current = null;
      }
    };
  }, [url]);

  const handleReload = useCallback(() => {
    webviewRef.current?.reload();
  }, []);

  return (
    <>
      <header className="link-drawer__header">
        <Button
          variant="icon"
          onClick={handleReload}
          title={t('linkDrawer.reload')}
          aria-label={t('linkDrawer.reload')}
        >
          <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
            <path
              d="M2 6a4 4 0 016.9-2.8L10 4M10 2v2.5H7.5M10 6a4 4 0 01-6.9 2.8L2 8M2 10V7.5h2.5"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Button>
        <div className="link-drawer__url" title={url}>{url}</div>
      </header>
      <div ref={hostRef} className="link-drawer__webview-host" />
    </>
  );
};
