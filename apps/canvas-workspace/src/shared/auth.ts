/**
 * In-app sign-in helper contract.
 *
 * Runtime-neutral (no Electron/Node imports). Google blocks account sign-in in
 * embedded <webview>s but accepts a top-level BrowserWindow (a full browser
 * context). This opens Google's sign-in in such a window, which shares the
 * default session with the app's webviews — so once the user signs in there,
 * the cookie lands in the same session the webview uses and webview pages
 * become logged in after a reload.
 */

export interface AuthApi {
  /**
   * Open Google sign-in in a top-level login window and resolve once the user
   * closes it. Callers typically reload the embedded browser afterwards so it
   * picks up the freshly-set session cookie.
   */
  openGoogleLogin: () => Promise<{ ok: boolean; error?: string }>;
}
