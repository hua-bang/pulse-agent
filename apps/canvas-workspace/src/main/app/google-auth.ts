import { app, session } from "electron";

// Google sign-in compatibility for embedded browsing surfaces.
//
// Google hard-blocks logins from anything it can fingerprint as an embedded
// or outdated browser ("This browser or app may not be secure" /
// `403: disallowed_useragent`). Since the Electron upgrade, bootstrap.ts
// keeps the UA string's Chrome version equal to the REAL bundled Chromium
// (so the UA and the Chromium-generated UA Client Hints agree), which
// removes the primary block. This module stays as defense-in-depth: it
// presents a *Firefox* identity on Google's account hosts only — Firefox
// sends no client hints at all, so there is no second signal for Google to
// cross-check even if it starts rejecting brand-less Chromium or the
// bundled version ages below the sign-in floor again. (Same approach
// Ferdium/WebCatalog-style Electron shells ship.) Two cooperating layers:
//
//  1. Per-webContents UA override while a contents is on a Google auth host.
//     This is what `navigator.userAgent` reports to page JS, and an active
//     per-contents override also stops Chromium from emitting client hints.
//  2. Session-level header rewrite for requests to Google auth hosts, which
//     guarantees the wire-level UA even for requests created before the
//     per-contents override landed, and strips residual `Sec-CH-*` headers.
//
// link-policy.ts owns the navigation/popup routing and consults
// isGoogleAuthUrl so auth legs stay in-app, where this compat layer applies.

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

// Must run after app-ready (needs defaultSession); bootstrap calls it from
// whenReady, before the first window opens.
export function setupGoogleAuthCompat(): void {
  const originalUserAgents = new WeakMap<object, string>();

  app.on("web-contents-created", (_event, contents) => {
    const applyUserAgentForUrl = (url: string) => {
      if (isGoogleAuthUrl(url)) {
        if (!originalUserAgents.has(contents)) {
          originalUserAgents.set(contents, contents.getUserAgent());
          contents.setUserAgent(googleAuthUserAgent());
        }
      } else if (originalUserAgents.has(contents)) {
        const original = originalUserAgents.get(contents);
        originalUserAgents.delete(contents);
        if (typeof original === "string") contents.setUserAgent(original);
      }
    };

    // will-navigate covers renderer-initiated navigations before the request
    // leaves; did-start-navigation additionally covers loadURL/popup initial
    // loads. Server-side redirect hops keep whatever UA the leg started with,
    // which is the correct behaviour for an OAuth continuation.
    contents.on("will-navigate", (_navEvent, url) => {
      applyUserAgentForUrl(url);
    });
    contents.on(
      "did-start-navigation",
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
