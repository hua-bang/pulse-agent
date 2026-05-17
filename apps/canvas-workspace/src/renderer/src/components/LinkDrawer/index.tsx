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

const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 360;
const MAX_WIDTH_VW_RATIO = 0.85;
const EXIT_ANIMATION_NAME = "link-drawer-out";

export const LinkDrawer = ({ activeWorkspaceId }: Props) => {
  // `url` holds the currently-rendered URL (kept around during the exit
  // animation so the webview doesn't snap blank mid-slide). `open` drives
  // the animation direction. Component unmounts when both are cleared
  // after the exit animation completes.
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [width, setWidth] = useState<number>(DEFAULT_WIDTH);
  const hostRef = useRef<HTMLDivElement>(null);
  const webviewRef = useRef<WebviewTag | null>(null);

  // Subscribe to URLs forwarded from the main process.
  useEffect(() => {
    return window.canvasWorkspace.link.onOpen(({ url: nextUrl }) => {
      setUrl(nextUrl);
      setOpen(true);
    });
  }, []);

  // ESC triggers the exit animation. Only bind while the drawer is
  // actually showing so ESC stays free for everything else.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // After the exit animation finishes, drop the URL so the webview gets
  // unmounted (releases the guest webContents). If the user re-opened
  // mid-animation `open` will already be `true` here and we leave URL
  // alone — the animation restarts forward and the webview survives.
  const handleAnimationEnd = useCallback(
    (e: React.AnimationEvent<HTMLElement>) => {
      if (!open && e.animationName === EXIT_ANIMATION_NAME) {
        setUrl(null);
      }
    },
    [open],
  );

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

  const close = useCallback(() => setOpen(false), []);

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

  // Drag the left edge to resize. Mirrors the chat-panel resize pattern in
  // Workbench/index.tsx: lock body cursor + selection during drag and tear
  // down listeners on mouseup so a missed mouseup doesn't strand them.
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = width;

      const onMouseMove = (ev: MouseEvent) => {
        const delta = startX - ev.clientX;
        const maxWidth = window.innerWidth * MAX_WIDTH_VW_RATIO;
        setWidth(Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + delta)));
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [width],
  );

  if (!url) return null;

  return (
    <aside
      className="link-drawer"
      data-state={open ? "open" : "closing"}
      onAnimationEnd={handleAnimationEnd}
      role="dialog"
      aria-label="Link preview"
      style={{ width }}
    >
      <div
        className="link-drawer__resize-handle"
        onMouseDown={handleResizeStart}
        aria-hidden="true"
      />
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
