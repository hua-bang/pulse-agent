// Google sign-in host detection for embedded browsing surfaces.
//
// History: on Electron 30 (Chromium 124) the bundled engine was below
// Google's supported-browser floor, so this module carried a full Firefox
// identity spoof (per-webContents UA override + defaultSession client-hint
// header stripping) to get accounts.google.com past its embedded/outdated
// browser checks. With the engine on a current Chromium, the app reports its
// real Chrome-flavoured identity (see spoofUserAgentFallback in bootstrap.ts:
// only the Electron/product tokens are stripped, the real Chrome version is
// kept), so UA string, UA Client Hints, and navigator.userAgentData agree
// naturally and the spoof layer is gone. If sign-in regresses, re-check the
// bundled Chromium age before reaching for identity spoofing again.
//
// What remains is the auth-host allowlist consumed by link-policy.ts and
// google-auth-popup.ts: in-place (redirect-mode) entry legs from <webview>
// guests are rerouted into a top-level BrowserWindow popup, because Google's
// strict full-page flow (/v3/signin) risk-scores embedded surfaces, and the
// window.open popup shape is the one that empirically passes.

// Exact-match allowlist. accounts.youtube.com participates in the Google
// sign-in cookie handshake. Keep this exact (no suffix matching): the check
// loosens navigation policy in link-policy.ts, so `accounts.google.com.evil`
// must never pass.
const GOOGLE_AUTH_HOSTS = new Set(["accounts.google.com", "accounts.youtube.com"]);

export function isGoogleAuthUrl(raw: string): boolean {
  try {
    const { protocol, hostname } = new URL(raw);
    return protocol === "https:" && GOOGLE_AUTH_HOSTS.has(hostname);
  } catch {
    return false;
  }
}
