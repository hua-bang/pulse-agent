import { app, session } from "electron";

// Google sign-in compatibility for embedded browsing surfaces.
//
// Google hard-blocks logins from anything it can fingerprint as an embedded
// or outdated browser ("This browser or app may not be secure" /
// `403: disallowed_useragent`). The app-wide UA spoof in bootstrap.ts rewrites
// the UA *string* to a current Chrome, but Chromium still derives UA Client
// Hints (`Sec-CH-UA` headers + `navigator.userAgentData`) from the real
// bundled Chromium version. accounts.google.com requests the full client-hint
// version list and cross-checks it against the UA string, so Chrome-flavoured
// spoofing on an older Chromium can never pass there — the two signals always
// disagree.
//
// The reliable workaround (the same one Ferdium/WebCatalog-style Electron
// shells ship) is to present a *Firefox* identity on Google's account hosts
// only: Firefox sends no client hints at all, so there is no second signal to
// contradict the UA string. Three cooperating layers:
//
//  1. Per-webContents UA override while a contents is on a Google auth host.
//     This is what `navigator.userAgent` reports to page JS.
//  2. Session-level header rewrite for requests to Google auth hosts, which
//     guarantees the wire-level UA even for requests created before the
//     per-contents override landed, and strips residual `Sec-CH-*` headers.
//  3. `navigator.userAgentData` neutralization on Google auth documents.
//     Layers 1+2 only cover the *string* UA and the *wire* headers — they do
//     NOT change `navigator.userAgentData`, a pure-JS API that reads the real
//     Chromium version WITHOUT any network request (`setUserAgent()` leaves it
//     intact; disabling the UA-CH Chromium feature via a command-line switch
//     also does NOT remove it — verified empirically on this Electron). The
//     strict full-page flow (`/v3/signin`, which GitHub's in-place redirect
//     login hits — vs. the lenient GIS *popup* flow Figma/Notion use) calls
//     `navigator.userAgentData.getHighEntropyValues()` client-side and rejects
//     the Firefox-UA-string / Chrome-userAgentData mismatch (→ `/rejected`).
//     The only version-robust fix is to run a script in the page's MAIN world
//     BEFORE its own scripts, redefining `navigator.userAgentData` to
//     `undefined` (what real Firefox exposes). Electron has no native
//     document-start main-world hook for a <webview> guest (preload runs in an
//     isolated world), so we use the DevTools protocol
//     (`Page.addScriptToEvaluateOnNewDocument`) via `webContents.debugger`,
//     attached only to contents that actually navigate to a Google auth host.
//     The injected script self-gates on hostname, so it is inert everywhere
//     except the Google auth documents.
//
// link-policy.ts owns the navigation/popup routing and consults
// isGoogleAuthUrl so auth legs stay in-app, where this compat layer applies.

// Runs in the page's MAIN world at document-start (before the page's own
// scripts). Self-gated to Google auth hosts: attaching the debugger registers
// this for every subsequent document on that contents, but it must be a no-op
// once the flow navigates back out to the embedding site.
const HIDE_UA_DATA_SOURCE = `(function () {
  try {
    var h = location.hostname;
    if (h !== "accounts.google.com" && h !== "accounts.youtube.com") return;
    Object.defineProperty(Navigator.prototype, "userAgentData", {
      configurable: true,
      enumerable: true,
      get: function () { return undefined; },
    });
  } catch (e) {}
})();`;

// Exact-match allowlist. accounts.youtube.com participates in the Google
// sign-in cookie handshake. Keep this exact (no suffix matching): the check
// loosens navigation policy in link-policy.ts, so `accounts.google.com.evil`
// must never pass.
const GOOGLE_AUTH_HOSTS = new Set(["accounts.google.com", "accounts.youtube.com"]);

// Firefox ESR major. Bump occasionally, alongside the Chrome-version spoof in
// bootstrap.ts, so the claimed browser doesn't age below Google's floor.
const FIREFOX_VERSION = "140.0";

export function isGoogleAuthUrl(raw: string): boolean {
  try {
    const { protocol, hostname } = new URL(raw);
    return protocol === "https:" && GOOGLE_AUTH_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

export function googleAuthUserAgent(
  platform: NodeJS.Platform = process.platform
): string {
  const platformToken =
    platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10.15"
      : platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";
  return `Mozilla/5.0 (${platformToken}; rv:${FIREFOX_VERSION}) Gecko/20100101 Firefox/${FIREFOX_VERSION}`;
}

export function rewriteGoogleAuthHeaders(
  requestHeaders: Record<string, string>
): Record<string, string> {
  const rewritten: Record<string, string> = {};
  for (const [name, value] of Object.entries(requestHeaders)) {
    const lower = name.toLowerCase();
    if (lower.startsWith("sec-ch-") || lower === "user-agent") continue;
    rewritten[name] = value;
  }
  rewritten["User-Agent"] = googleAuthUserAgent();
  return rewritten;
}

// Attach the DevTools protocol to a contents heading for a Google auth host
// and register the userAgentData-hiding script for its documents. Idempotent
// per contents (the WeakSet guards re-entry across the many OAuth hops), and
// silent if the debugger can't attach (e.g. DevTools is already open on it).
function hideUserAgentDataOnGoogle(
  contents: Electron.WebContents,
  attached: WeakSet<object>
): void {
  if (attached.has(contents)) return;
  const dbg = contents.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach("1.3");
  } catch {
    return;
  }
  attached.add(contents);
  // Applies to the NEXT document created — we call this on will-navigate /
  // will-redirect, before the Google document commits, so its own scripts see
  // the redefined property.
  dbg
    .sendCommand("Page.addScriptToEvaluateOnNewDocument", {
      source: HIDE_UA_DATA_SOURCE,
    })
    .catch(() => {
      attached.delete(contents);
    });
}

// Must run after app-ready (needs defaultSession); bootstrap calls it from
// whenReady, before the first window opens.
export function setupGoogleAuthCompat(): void {
  const originalUserAgents = new WeakMap<object, string>();
  const uaDataHidden = new WeakSet<object>();

  app.on("web-contents-created", (_event, contents) => {
    const applyUserAgentForUrl = (url: string) => {
      if (isGoogleAuthUrl(url)) {
        if (!originalUserAgents.has(contents)) {
          originalUserAgents.set(contents, contents.getUserAgent());
          contents.setUserAgent(googleAuthUserAgent());
        }
        // Match the JS-visible client-hint surface to the Firefox UA string.
        hideUserAgentDataOnGoogle(contents, uaDataHidden);
      } else if (originalUserAgents.has(contents)) {
        const original = originalUserAgents.get(contents);
        originalUserAgents.delete(contents);
        if (typeof original === "string") contents.setUserAgent(original);
      }
    };

    // will-navigate covers renderer-initiated navigations before the request
    // leaves; did-start-navigation additionally covers loadURL/popup initial
    // loads; will-redirect covers server-side redirect hops — the common OAuth
    // entry (site.com/auth/google → 302 → accounts.google.com) fires NEITHER
    // of the other two with the Google URL. Without it the Google document
    // commits under the Chrome-spoof identity, so page JS sees a Chrome UA
    // string plus real-version `navigator.userAgentData`, and Google's
    // client-side check bounces to /v3/signin/rejected even though the wire
    // headers (rewritten below) said Firefox.
    contents.on("will-navigate", (_navEvent, url) => {
      applyUserAgentForUrl(url);
    });
    contents.on(
      "did-start-navigation",
      (_navEvent, url, _isInPage, isMainFrame) => {
        if (isMainFrame) applyUserAgentForUrl(url);
      }
    );
    contents.on(
      "will-redirect",
      (_navEvent, url, _isInPage, isMainFrame) => {
        if (isMainFrame) applyUserAgentForUrl(url);
      }
    );
  });

  // NOTE: Electron allows exactly ONE onBeforeSendHeaders listener per
  // session — this is currently the sole registrant on defaultSession. If a
  // second consumer ever needs request-header access, centralize both here.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        "https://accounts.google.com/*",
        "https://accounts.youtube.com/*",
      ],
    },
    (details, callback) => {
      callback({
        requestHeaders: rewriteGoogleAuthHeaders(details.requestHeaders),
      });
    }
  );
}
