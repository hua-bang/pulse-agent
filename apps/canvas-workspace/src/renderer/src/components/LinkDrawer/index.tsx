/**
 * Right-side preview drawer for external links intercepted from embedded
 * webviews and sandboxed iframes. Mounted once at app level and driven by
 * the `link:open` IPC channel from the main process. The drawer exposes
 * three actions:
 *  - close (X / backdrop)
 *  - open in system browser (escape hatch for X-Frame-Options-blocked
 *    sites, or when the user wants a real browser tab)
 *  - add to current canvas (creates a new iframe node bound to the URL)
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import "./index.css";

interface WebviewTag extends HTMLElement {
  getWebContentsId(): number;
  reload(): void;
}

interface Props {
  /** Active workspace id, used as the target for "add to current canvas". */
  activeWorkspaceId: string;
}

export const LinkDrawer = ({ activeWorkspaceId }: Props) => {
  const [url, setUrl] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<WebviewTag | null>(null);

  // Subscribe to URLs forwarded from the main process.
  useEffect(() => {
    return window.canvasWorkspace.link.onOpen(({ url: nextUrl }) => {
      setUrl(nextUrl);
    });
  }, []);

  // ESC closes the drawer. No backdrop on purpose — the canvas under the
  // drawer's left edge should stay pannable / editable while the preview
  // is up (the drawer is a side panel, not a modal).
  useEffect(() => {
    if (!url) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUrl(null);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [url]);

  // Imperatively mount a fresh `<webview>` every time the drawer opens or
  // the URL changes. The element has to be created off-DOM with
  // `allowpopups` already set, otherwise Electron's `connectedCallback`
  // configures the guest with popups disabled (see IframeNodeBody for the
  // full explanation of the React-18 + Electron timing issue).
  useLayoutEffect(() => {
    if (!url) return;
    const host = hostRef.current;
    if (!host) return;

    const webview = document.createElement("webview") as WebviewTag;
    webview.setAttribute("allowpopups", "");
    webview.setAttribute("src", url);
    webview.className = "link-drawer__webview";
    host.appendChild(webview);
    webviewRef.current = webview;

    return () => {
      webview.remove();
      if (webviewRef.current === webview) {
        webviewRef.current = null;
      }
    };
  }, [url]);

  const close = useCallback(() => setUrl(null), []);

  const handleOpenInBrowser = useCallback(() => {
    if (!url) return;
    void window.canvasWorkspace.shell.openExternal(url);
  }, [url]);

  const handleAddToCanvas = useCallback(() => {
    if (!url || !activeWorkspaceId) return;
    // Cross-component event handed off to the active Canvas. Going through
    // a window event keeps the drawer decoupled from the canvas internals;
    // the matching listener lives in components/Canvas/index.tsx.
    window.dispatchEvent(
      new CustomEvent("canvas:add-iframe-from-url", {
        detail: { workspaceId: activeWorkspaceId, url },
      }),
    );
    close();
  }, [url, activeWorkspaceId, close]);

  const handleReload = useCallback(() => {
    webviewRef.current?.reload();
  }, []);

  if (!url) return null;

  return (
    <aside className="link-drawer" role="dialog" aria-label="Link preview">
        <header className="link-drawer__header">
          <button
            type="button"
            className="link-drawer__icon-btn"
            onClick={handleReload}
            title="Reload"
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
          </button>
          <div className="link-drawer__url" title={url}>{url}</div>
          <button
            type="button"
            className="link-drawer__icon-btn"
            onClick={close}
            aria-label="Close"
            title="Close"
          >
            <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
              <path
                d="M3 3l6 6M9 3l-6 6"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </header>
        <div ref={hostRef} className="link-drawer__webview-host" />
        <footer className="link-drawer__footer">
          <button
            type="button"
            className="link-drawer__btn"
            onClick={handleOpenInBrowser}
          >
            用系统浏览器打开
          </button>
          <button
            type="button"
            className="link-drawer__btn link-drawer__btn--primary"
            onClick={handleAddToCanvas}
            disabled={!activeWorkspaceId}
            title={activeWorkspaceId ? undefined : "No active canvas"}
          >
            加入当前画布
          </button>
        </footer>
      </aside>
  );
};
