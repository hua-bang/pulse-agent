import {
  firefoxUserAgent,
  stripClientHintsPinUserAgent,
  type EmbeddedIdentityRule,
} from "./embedded-identity";

// x.com (Twitter) compatibility for embedded browsing surfaces.
//
// Opening x.com in a webview tab renders x.com's "Something went wrong, but
// don't fret" error boundary instead of the timeline. Root cause is the same
// UA-vs-client-hint mismatch documented in embedded-identity.ts and
// google-auth.ts: bootstrap.ts spoofs the UA string to Chrome/140 while
// Chromium keeps emitting UA Client Hints (and `navigator.userAgentData`) from
// the real bundled version, and x.com's SPA cross-checks them and throws
// during init. The "Some privacy related extensions may cause issues" line is
// x.com's generic init-failure copy, not an actual extension problem — there
// are no extensions in this Electron shell.
//
// Remedy mirrors the Google auth hosts: present a consistent Firefox identity
// on x.com hosts. Firefox emits no client hints, so there is no second
// identity source to mismatch, and x.com fully supports the Firefox code path.
// Wired through the shared embedded-identity coordinator so the one-per-session
// header listener and the per-contents UA manager stay centralized.

// Domain suffixes covering x.com / twitter.com surfaces: the main app, api.*
// and mobile.* subdomains, and the twitter.com aliases that redirect to x.com.
// Unlike the Google auth allowlist, this identity swap does NOT loosen
// navigation policy, so suffix matching is safe here.
const X_COM_DOMAINS = ["x.com", "twitter.com"];

// Firefox ESR major, matched to google-auth.ts so both hosts present the same
// believable, above-floor browser version.
const FIREFOX_VERSION = "140.0";

export function isXComUrl(raw: string): boolean {
  try {
    const { protocol, hostname } = new URL(raw);
    if (protocol !== "https:") return false;
    return X_COM_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
}

export function xComUserAgent(
  platform: NodeJS.Platform = process.platform
): string {
  return firefoxUserAgent(FIREFOX_VERSION, platform);
}

export function rewriteXComHeaders(
  requestHeaders: Record<string, string>
): Record<string, string> {
  return stripClientHintsPinUserAgent(requestHeaders, xComUserAgent());
}

export function xComIdentityRule(): EmbeddedIdentityRule {
  return {
    id: "x-com",
    matches: isXComUrl,
    userAgent: xComUserAgent(),
    headerUrls: [
      "https://x.com/*",
      "https://*.x.com/*",
      "https://twitter.com/*",
      "https://*.twitter.com/*",
    ],
    rewriteHeaders: rewriteXComHeaders,
  };
}
