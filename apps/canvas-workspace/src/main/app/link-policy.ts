import { app, shell, type WebContents } from "electron";
import { isSafeExternalUrl } from "./shell-ipc";
import { isGoogleAuthUrl } from "./google-auth";
import { openGoogleAuthPopup } from "./google-auth-popup";

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

      if (isEditorExternalUrl(url)) {
        openExternal(url);
        return { action: "deny" };
      }

      // OAuth-style popups need a real Chromium BrowserWindow. The popup
      // inherits the opener's session, so the login cookie lands in the SAME
      // session the webview uses and the round-trip (opener messaging /
      // window.close) completes in-app. Google auth URLs get this treatment
      // for EVERY disposition (window.open popups AND target=_blank links):
      // handing them to the system browser would strand the login cookie in a
      // session the app can never read. google-auth.ts makes these in-app
      // surfaces pass Google's embedded-browser checks (Firefox UA identity,
      // no contradicting client hints).
      if (disposition === "new-window" || isGoogleAuthUrl(url)) {
        return { action: "allow" };
      }

      // Everything else is a "preview this link" intent, route to the side
      // drawer.
      forwardLinkToRenderer(contents, url);
      return { action: "deny" };
    });

    if (contents.getType() === "webview") {
      // Redirect-mode Google sign-in ENTRY legs (webview page → Google auth
      // host) leave the webview: Google's strict full-page flow rejects
      // embedded surfaces, so the leg is rerouted into a top-level popup on
      // the same session (see google-auth-popup.ts). Legs where the webview
      // is ALREADY on a Google host (intermediate hops, post-login exits)
      // stay in place via isEmbeddedAuthNavigation.
      const rerouteAuthEntry = (
        event: { preventDefault(): void },
        url: string
      ): boolean => {
        if (!isGoogleAuthUrl(url) || isGoogleAuthUrl(contents.getURL())) {
          return false;
        }
        event.preventDefault();
        openGoogleAuthPopup(contents, url);
        return true;
      };

      contents.on("will-navigate", (event, url) => {
        if (rerouteAuthEntry(event, url)) return;
        const currentUrl = contents.getURL();
        let crossOrigin = false;
        try {
          crossOrigin = new URL(url).origin !== new URL(currentUrl).origin;
        } catch {
          crossOrigin = true;
        }
        if (crossOrigin && isEmbeddedAuthNavigation(currentUrl, url)) {
          return;
        }
        if (crossOrigin && isSafeExternalUrl(url)) {
          event.preventDefault();
          if (isEditorExternalUrl(url)) {
            openExternal(url);
          } else {
            forwardLinkToRenderer(contents, url);
          }
        }
      });

      // The common OAuth entry is a SAME-origin navigation
      // (github.com/login → github.com/sessions/…) that 302s into
      // accounts.google.com — the cross-origin will-navigate path never sees
      // it; only will-redirect fires with the Google URL.
      contents.on("will-redirect", (event, url) => {
        rerouteAuthEntry(event, url);
      });
    }
  });
}

function isEmbeddedAuthNavigation(currentRaw: string, nextRaw: string): boolean {
  // Google sign-in legs that reach here have the webview ALREADY on a Google
  // auth host (entry legs are rerouted to a popup before this check):
  // intermediate hops between Google hosts and the post-login continuation
  // back to the embedding site. Both must stay in the webview so the session
  // cookie lands where the embedded site can use it — kicking either to the
  // system browser strands the login there.
  if (isGoogleAuthUrl(nextRaw) || isGoogleAuthUrl(currentRaw)) return true;
  try {
    const current = new URL(currentRaw);
    const next = new URL(nextRaw);
    return isFigmaSamlCallback(next) || (isFigmaHost(current.hostname) && isLikelySsoHost(next.hostname));
  } catch {
    return false;
  }
}

function isFigmaHost(hostname: string): boolean {
  return hostname === "figma.com" || hostname === "www.figma.com";
}

function isLikelySsoHost(hostname: string): boolean {
  return hostname.includes("sso") || hostname.includes("okta") || hostname.includes("onelogin");
}

function isFigmaSamlCallback(url: URL): boolean {
  return isFigmaHost(url.hostname) && /^\/saml\/[^/]+\/consume\/?$/i.test(url.pathname);
}

function isEditorExternalUrl(raw: string): boolean {
  try {
    const protocol = new URL(raw).protocol;
    return protocol === "vscode:" || protocol === "vscode-insiders:";
  } catch {
    return false;
  }
}

function openExternal(url: string): void {
  void shell.openExternal(url).catch(() => undefined);
}

function forwardLinkToRenderer(contents: WebContents, url: string): void {
  // For <webview>, the message must reach the embedder (the main renderer
  // hosting the drawer), not the guest itself. hostWebContents is undefined
  // for top-level webContents; there, contents already is the renderer we want.
  const target = contents.hostWebContents ?? contents;
  if (target.isDestroyed()) return;
  target.send("link:open", { url });
}
