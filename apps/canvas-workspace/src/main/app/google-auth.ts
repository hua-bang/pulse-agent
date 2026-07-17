import { app, session } from "electron";

// Google sign-in compatibility for embedded browsing surfaces.
//
// The identity presented on Google's auth hosts is selectable via
// PULSE_GOOGLE_AUTH_IDENTITY:
//  - "firefox" (default): per-webContents Firefox UA override + client-hint
//    header stripping — the configuration Electron shells in the wild
//    (Ferdium/WebCatalog-style) ship, and the only one with an observed
//    pass in this app (the GIS popup flows).
//  - "chrome": no override — experiment arm only. On Electron 30 this is
//    KNOWN-BROKEN for Google: bootstrap.ts rewrites the UA's Chrome version
//    to a current one (Notion floor) while client hints derive from the
//    real Chromium 124, and accounts.google.com rejects the mismatch.
//
// EVIDENCE LOG (2026-07-17 investigation; kept so the loop is not re-run
// blindly):
//  - Electron 30 + firefox: GIS popup flows (Figma/Notion) passed; GitHub's
//    strict /v3/signin, running in-place in a <webview>, was rejected —
//    the original defect.
//  - Electron 42 + honest chrome identity (real Chrome 148 UA, consistent
//    client hints/userAgentData, window.chrome present) + popup reroute,
//    cold session: /v3/signin rejected AFTER credential submission; the
//    previously-passing GIS flows failed the same day too. Attribution
//    leans strongly toward "a Chrome claim invites Chrome-specific BotGuard
//    checks an Electron shell cannot pass": every rejection rendered the
//    embedded-browser error class ("This browser or app may not be
//    secure"), NOT an account-risk challenge (verify-it's-you / captcha /
//    unusual-activity), which a flagged account would produce. The
//    sticky-account alternative was never fully falsified (identity-only
//    A/B not run) but is disfavored by the error semantics. DECISION: the
//    Electron 42 upgrade was reverted and the battle-tested Electron 30 +
//    firefox configuration restored. First post-revert GIS pass with the
//    same account would falsify the sticky-account hypothesis outright.
//  - Codex/ChatGPT desktop teardown (2026-07-17): OpenAI's desktop
//    embedded browser passes Google sign-in, but it is NOT an Electron
//    trick. The browser lives in ChatGPT.app, which IS a full Chromium
//    fork ("Codex Framework", 150.0.7871.124 — same build train as the
//    installed official Chrome 150.0.7871.115 — updated via Sparkle
//    full-app updates). Wire headers showed pure Chrome 150 UA +
//    "Google Chrome" client hints because the engine IS Chrome; it
//    passes Chrome-specific BotGuard checks by definition. (The
//    standalone /Applications/Codex.app is a separate Electron 42
//    shell and was a red herring.) Conclusion: there is NO
//    header/UA-level technique that lets an Electron shell pass
//    Google's strict flow; the only "real Chrome identity" path is
//    maintaining a Chromium fork (dedicated team, ~4-week upstream
//    rebase cadence, ~350MB full-app updates), which is ruled out.
//    The "honest Chrome identity" experiment class is closed.
//
// Why a Firefox claim can help at all: Firefox sends no client hints, so
// there is no second identity source to cross-check. Two cooperating layers:
//  1. Per-webContents UA override while a contents is on a Google auth host
//     (what page JS sees; an active override also stops client-hint
//     emission).
//  2. Session-level header rewrite for requests to Google auth hosts
//     (guarantees the wire-level UA even for requests created before the
//     per-contents override landed; strips residual `Sec-CH-*`).
//
// link-policy.ts owns the navigation/popup routing: in-place (redirect-mode)
// entry legs from <webview> guests are rerouted into a top-level
// BrowserWindow popup (google-auth-popup.ts) because Google's strict
// full-page flow (/v3/signin) additionally risk-scores embedded surfaces.

// Exact-match allowlist. accounts.youtube.com participates in the Google
// sign-in cookie handshake. Keep this exact (no suffix matching): the check
// loosens navigation policy in link-policy.ts, so `accounts.google.com.evil`
// must never pass.
const GOOGLE_AUTH_HOSTS = new Set(["accounts.google.com", "accounts.youtube.com"]);

// Firefox ESR major. Bump occasionally so the claimed browser doesn't age
// below Google's floor.
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

export function googleAuthIdentityMode(): "firefox" | "chrome" {
  return process.env.PULSE_GOOGLE_AUTH_IDENTITY === "chrome"
    ? "chrome"
    : "firefox";
}

// Must run after app-ready (needs defaultSession); bootstrap calls it from
// whenReady, before the first window opens.
export function setupGoogleAuthCompat(): void {
  if (googleAuthIdentityMode() === "chrome") return;

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
