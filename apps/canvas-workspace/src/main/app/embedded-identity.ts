import { app, session, type Session, type WebContents } from "electron";

// Host-scoped browser identity for embedded browsing surfaces (<webview>
// guests and OAuth popups).
//
// bootstrap.ts rewrites the app-wide UA string to a current Chrome
// (Chrome/140, Electron/product tokens stripped) so services that gate on the
// UA string alone accept the embedded browser. That rewrite is NOT enough for
// sites that cross-check the UA string against UA Client Hints (the
// `Sec-CH-UA*` request headers) or `navigator.userAgentData`: Chromium still
// derives those from the REAL bundled version, so the claimed Chrome/140 and
// the emitted client hints disagree. accounts.google.com rejects the mismatch
// at sign-in; x.com's SPA trips its runtime guard and renders its
// "Something went wrong" error boundary.
//
// The remedy, per host, is a CONSISTENT identity. A Firefox UA emits no client
// hints, so there is no second identity source to cross-check. Two cooperating
// layers, both wired here:
//   1. A per-webContents UA override while a contents is on a matching host —
//      what page JS sees; an active override also stops client-hint emission
//      for that contents, so its subresource/API requests stay consistent too.
//   2. A session-level request-header rewrite for those hosts — pins the wire
//      UA even for requests created before the per-contents override landed,
//      and strips residual `Sec-CH-*`.
//
// Electron permits exactly ONE onBeforeSendHeaders listener per session, and a
// single per-contents override manager avoids two managers clobbering each
// other's saved "original" UA on a contents that crosses between host sets. So
// EVERY host identity (Google auth, x.com) is wired through this one
// coordinator rather than registering its own listeners.

export interface EmbeddedIdentityRule {
  // Stable id, for diagnostics only.
  id: string;
  // True for URLs this identity should apply to.
  matches(url: string): boolean;
  // UA string presented on matching hosts (page JS + wire).
  userAgent: string;
  // webRequest URL match patterns for the session header rewrite. Empty skips
  // the header layer for this rule (per-contents override only).
  headerUrls: string[];
  // Rewrites request headers for matching hosts (strip client hints, pin UA).
  rewriteHeaders(headers: Record<string, string>): Record<string, string>;
}

// Build a platform-appropriate Firefox UA. Firefox sends no UA Client Hints,
// which is the whole point of claiming it — see the module header.
export function firefoxUserAgent(
  version: string,
  platform: NodeJS.Platform = process.platform
): string {
  const platformToken =
    platform === "darwin"
      ? "Macintosh; Intel Mac OS X 10.15"
      : platform === "win32"
        ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64";
  return `Mozilla/5.0 (${platformToken}; rv:${version}) Gecko/20100101 Firefox/${version}`;
}

// Drop every `Sec-CH-*` client-hint header and the incoming UA, then pin the
// given UA. Shared by all Firefox-identity rules so the wire identity matches
// the per-contents override exactly.
export function stripClientHintsPinUserAgent(
  requestHeaders: Record<string, string>,
  userAgent: string
): Record<string, string> {
  const rewritten: Record<string, string> = {};
  for (const [name, value] of Object.entries(requestHeaders)) {
    const lower = name.toLowerCase();
    if (lower.startsWith("sec-ch-") || lower === "user-agent") continue;
    rewritten[name] = value;
  }
  rewritten["User-Agent"] = userAgent;
  return rewritten;
}

// Must run after app-ready (needs the target session's webRequest). bootstrap
// calls it from whenReady, before the first window opens.
export function setupEmbeddedIdentity(
  rules: EmbeddedIdentityRule[],
  targetSession: Session = session.defaultSession
): void {
  if (rules.length === 0) return;

  // Per-webContents UA override — one manager, one WeakMap, so a contents that
  // crosses between host sets never has two managers fighting over its saved
  // original UA.
  const savedUserAgent = new WeakMap<WebContents, string>();

  app.on("web-contents-created", (_event, contents) => {
    const applyForUrl = (url: string) => {
      const rule = rules.find((candidate) => candidate.matches(url));
      if (rule) {
        if (!savedUserAgent.has(contents)) {
          savedUserAgent.set(contents, contents.getUserAgent());
        }
        // Set only when the identity actually changes so repeat same-host
        // navigations don't churn the UA.
        if (contents.getUserAgent() !== rule.userAgent) {
          contents.setUserAgent(rule.userAgent);
        }
      } else if (savedUserAgent.has(contents)) {
        const original = savedUserAgent.get(contents);
        savedUserAgent.delete(contents);
        if (typeof original === "string") contents.setUserAgent(original);
      }
    };

    // will-navigate covers renderer-initiated navigations before the request
    // leaves; did-start-navigation additionally covers loadURL / a webview's
    // initial src load and popups. Server-side redirect hops keep whatever UA
    // the leg started with, which is correct for an OAuth continuation.
    contents.on("will-navigate", (_navEvent, url) => applyForUrl(url));
    contents.on(
      "did-start-navigation",
      (_navEvent, url, _isInPage, isMainFrame) => {
        if (isMainFrame) applyForUrl(url);
      }
    );
  });

  // Single session-level request-header rewrite. Electron allows exactly one
  // onBeforeSendHeaders listener per session; this is the sole registrant on
  // the target session, dispatching to whichever rule owns the request host.
  const headerRules = rules.filter((rule) => rule.headerUrls.length > 0);
  if (headerRules.length === 0) return;

  targetSession.webRequest.onBeforeSendHeaders(
    { urls: headerRules.flatMap((rule) => rule.headerUrls) },
    (details, callback) => {
      const rule = headerRules.find((candidate) =>
        candidate.matches(details.url)
      );
      callback({
        requestHeaders: rule
          ? rule.rewriteHeaders(details.requestHeaders)
          : details.requestHeaders,
      });
    }
  );
}
