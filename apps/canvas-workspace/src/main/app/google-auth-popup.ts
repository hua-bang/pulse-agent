import { BrowserWindow, type WebContents } from "electron";
import { isGoogleAuthUrl } from "./google-auth";

// Why a popup: Google's strict full-page sign-in flow
// (accounts.google.com/v3/signin) risk-scores the surface it runs in, and a
// <webview> guest is the most embedded-looking surface this app has — the UA
// identity spoof in google-auth.ts is not always enough there ("This browser
// may not be secure"). The flows that empirically pass in this app
// (Figma/Notion) run in a real top-level BrowserWindow created by
// window.open, so link-policy.ts reroutes redirect-mode (in-place) auth
// entries out of the webview into that same shape.
//
// Session sharing is the load-bearing part: the popup runs on the opener
// webview's session, so every cookie Google and the continuation set lands
// where the embedding site reads them. The exit leg — the first non-Google
// navigation heading back to the opener's site — is handed back to the
// webview so the one-shot continuation URL is consumed exactly once, in the
// surface the user is actually looking at, and the popup closes itself.

const POPUP_WIDTH = 520;
const POPUP_HEIGHT = 720;

export function openGoogleAuthPopup(opener: WebContents, url: string): BrowserWindow {
  const openerSite = registrableSite(opener.getURL());
  debugLog("popup: opening for", url, "opener site:", openerSite);

  const popup = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    autoHideMenuBar: true,
    webPreferences: {
      session: opener.session,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const handleExitLeg = (event: { preventDefault(): void }, nextUrl: string) => {
    // Hops between Google auth hosts (accounts.google.com ↔
    // accounts.youtube.com) are part of the sign-in handshake — stay put.
    if (isGoogleAuthUrl(nextUrl)) return;
    // A non-Google navigation that does NOT return to the opener's site is a
    // side excursion (support.google.com help links etc.), not the OAuth
    // continuation — let the popup browse there instead of hijacking the
    // opener webview.
    if (!isReturnToOpener(nextUrl, openerSite)) return;
    // Nobody to hand back to; finish in the popup (the session is shared, so
    // the login still lands).
    if (opener.isDestroyed()) return;
    debugLog("popup: handing continuation back to opener:", nextUrl);
    event.preventDefault();
    void opener.loadURL(nextUrl);
    popup.destroy();
  };

  popup.webContents.on("will-navigate", handleExitLeg);
  popup.webContents.on("will-redirect", handleExitLeg);

  void popup.webContents.loadURL(url);
  return popup;
}

function isReturnToOpener(nextRaw: string, openerSite: string | null): boolean {
  let hostname: string;
  try {
    const next = new URL(nextRaw);
    if (next.protocol !== "https:" && next.protocol !== "http:") return false;
    hostname = next.hostname;
  } catch {
    return false;
  }
  // Opener URL was unreadable — accept any non-Google web navigation as the
  // continuation rather than stranding the login in the popup.
  if (!openerSite) return true;
  return hostname === openerSite || hostname.endsWith(`.${openerSite}`);
}

// Naive registrable domain: last two labels. Wrong for multi-label public
// suffixes (co.uk) — acceptable here because a miss only means the exit leg
// finishes in the popup instead of being handed back, and the shared session
// still carries the login.
function registrableSite(raw: string): string | null {
  try {
    const { hostname } = new URL(raw);
    const labels = hostname.split(".").filter(Boolean);
    if (labels.length < 2) return hostname || null;
    return labels.slice(-2).join(".");
  } catch {
    return null;
  }
}

function debugLog(...args: unknown[]): void {
  if (process.env.PULSE_DEBUG_GOOGLE_AUTH) console.log("[google-auth]", ...args);
}
