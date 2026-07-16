/**
 * Browser-identity spoofing for embedded web content.
 *
 * Two layers must AGREE on the Chrome version or consistency checks (notably
 * Google's embedded-browser / sign-in detection) flag the mismatch:
 *
 *   1. The User-Agent STRING (`app.userAgentFallback`) — strip the Electron /
 *      product tokens and rewrite the Chrome version to a recent stable one, so
 *      services that gate on a modern Chrome (e.g. Notion) accept the webviews.
 *   2. The User-Agent CLIENT HINTS (`Sec-CH-UA*` request headers) — Electron
 *      otherwise sends the REAL bundled Chromium version (e.g. 124), so a site
 *      sees "UA says 140, hints say 124" and rejects the request. We rewrite
 *      the version-bearing hint headers to match SPOOFED_CHROME_MAJOR.
 *
 * NOTE: this only aligns the HTTP layer. JS-side `navigator.userAgentData`
 * still reflects the real Chromium, so a page doing high-entropy JS detection
 * (Google may) can still tell — in-app Google account sign-in is best-effort,
 * not guaranteed. The system-browser fallback stays the reliable path.
 */

import { app, session } from 'electron';

export const SPOOFED_CHROME_MAJOR = '140';

const VERSION_HINT_HEADERS = new Set([
  'sec-ch-ua',
  'sec-ch-ua-full-version-list',
  'sec-ch-ua-full-version',
]);

export function spoofUserAgentFallback(): void {
  app.userAgentFallback = app.userAgentFallback
    .replace(/\s?Electron\/\S+/g, '')
    .replace(/\s?PulseCanvas\/\S+/g, '')
    .replace(/Chrome\/\d+(?:\.\d+){0,3}/g, `Chrome/${SPOOFED_CHROME_MAJOR}.0.0.0`);
}

/** Brand list consistent with the spoofed Chrome major, e.g.
 *  `"Chromium";v="140", "Google Chrome";v="140", "Not?A_Brand";v="24"`.
 *  `full` uses the four-part version form used by the full-version-list hint. */
function brandList(full: boolean): string {
  const chrome = full ? `${SPOOFED_CHROME_MAJOR}.0.0.0` : SPOOFED_CHROME_MAJOR;
  const greased = full ? '24.0.0.0' : '24';
  return `"Chromium";v="${chrome}", "Google Chrome";v="${chrome}", "Not?A_Brand";v="${greased}"`;
}

/**
 * Rewrite the version-bearing `Sec-CH-UA*` request headers so the client hints
 * agree with the spoofed Chrome major. Only headers the request ALREADY sends
 * are rewritten — we never add new hints, and non-version hints
 * (platform/arch/model) pass through untouched. Pure for testability.
 */
export function rewriteClientHintHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...headers };
  for (const key of Object.keys(out)) {
    const lower = key.toLowerCase();
    if (!VERSION_HINT_HEADERS.has(lower)) continue;
    if (lower === 'sec-ch-ua') out[key] = brandList(false);
    else if (lower === 'sec-ch-ua-full-version-list') out[key] = brandList(true);
    else out[key] = `"${SPOOFED_CHROME_MAJOR}.0.0.0"`; // sec-ch-ua-full-version
  }
  return out;
}

/**
 * Install the client-hint header rewrite on the default session (shared by the
 * main window, every <webview>, and OAuth popup windows). Only one
 * onBeforeSendHeaders handler exists in the app, so this owns it.
 */
export function installClientHintsConsistency(): void {
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: rewriteClientHintHeaders(details.requestHeaders) });
  });
}
