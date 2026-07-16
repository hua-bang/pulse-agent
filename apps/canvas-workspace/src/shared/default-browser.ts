/**
 * Default-browser (http/https protocol client) contract.
 *
 * Runtime-neutral: no Electron / Node / process imports (enforced by
 * architecture-boundaries.test.ts). Shared by main (implementation),
 * preload (bridge), and renderer (Settings toggle).
 *
 * When enabled, the OS hands http/https link activations to Pulse Canvas.
 * Inbound URLs are surfaced in the app via the existing `link:open` embedded
 * browser path (RightDock link tab).
 */

export interface DefaultBrowserStatus {
  /** True when this app is currently the OS handler for the `http` scheme. */
  http: boolean;
  /** True when this app is currently the OS handler for the `https` scheme. */
  https: boolean;
  /** True only when the app owns BOTH http and https. */
  isDefault: boolean;
  /**
   * False in unpackaged dev runs, where OS registration is unreliable /
   * non-persistent. The UI uses this to warn that the toggle only takes real
   * effect in a packaged build.
   */
  isPackaged: boolean;
  /** `process.platform` — lets the UI tailor the "confirm in System Settings" hint. */
  platform: string;
}

export interface DefaultBrowserApi {
  /** Current registration state for http + https. */
  status: () => Promise<DefaultBrowserStatus>;
  /**
   * Register (enabled=true) or unregister (enabled=false) this app as the
   * http/https handler, then return the resulting status. On macOS/Windows the
   * OS may still require the user to confirm the switch in System Settings —
   * `status().isDefault` reflects the real, post-confirmation state.
   */
  set: (enabled: boolean) => Promise<DefaultBrowserStatus>;
  /**
   * Drain URLs captured before a renderer was ready to receive them (cold
   * start launched by a link). Returns and clears the queue; callers open each
   * URL. Warm-path URLs arrive over `link:open` instead.
   */
  consumePending: () => Promise<{ urls: string[] }>;
}
