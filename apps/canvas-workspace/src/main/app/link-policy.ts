import { app, type WebContents } from "electron";
import { isSafeExternalUrl } from "./shell-ipc";

// Centralized popup policy. Fires for every webContents the app ever creates:
// the main BrowserWindow, sandboxed iframes within it, and every <webview> tag
// mounted by an iframe canvas node. The handler is installed before the
// embedded page can run JavaScript, which is the only timing that survives
// SPA-driven window.open calls.
//
// Instead of opening every intercepted URL in the system browser, forward it
// to the host renderer over the `link:open` channel. The renderer surfaces it
// in a side drawer with preview and explicit actions.
export function setupLinkPolicy(): void {
  app.on("web-contents-created", (_event, contents) => {
    contents.setWindowOpenHandler(({ url, disposition }) => {
      if (!isSafeExternalUrl(url)) return { action: "deny" };

      // OAuth-style popups need a real BrowserWindow. The page reads back the
      // returned window reference and relies on opener messaging / window.close
      // to finish the auth round-trip.
      if (disposition === "new-window") {
        return { action: "allow" };
      }

      // Everything else is a "preview this link" intent, route to the side
      // drawer.
      forwardLinkToRenderer(contents, url);
      return { action: "deny" };
    });

    if (contents.getType() === "webview") {
      contents.on("will-navigate", (event, url) => {
        const currentUrl = contents.getURL();
        let crossOrigin = false;
        try {
          crossOrigin = new URL(url).origin !== new URL(currentUrl).origin;
        } catch {
          crossOrigin = true;
        }
        if (crossOrigin && isSafeExternalUrl(url)) {
          event.preventDefault();
          forwardLinkToRenderer(contents, url);
        }
      });
    }
  });
}

function forwardLinkToRenderer(contents: WebContents, url: string): void {
  // For <webview>, the message must reach the embedder (the main renderer
  // hosting the drawer), not the guest itself. hostWebContents is undefined
  // for top-level webContents; there, contents already is the renderer we want.
  const target = contents.hostWebContents ?? contents;
  if (target.isDestroyed()) return;
  target.send("link:open", { url });
}
