/**
 * Default-browser (http/https protocol client) contract.
 *
 * Runtime-neutral: no Electron / Node / process imports (enforced by
 * architecture-boundaries.test.ts). Shared by main (implementation), preload
 * (bridge), and renderer.
 *
 * When enabled (via the "Set as default browser" experimental flag), the OS
 * hands http/https link activations to Pulse Canvas. Inbound URLs are surfaced
 * in the app via the existing `link:open` embedded browser path (RightDock
 * link tab). The registration itself is driven from the experimental flag
 * toggle in main; the renderer only needs to drain cold-start URLs.
 */

export interface DefaultBrowserStatus {
  /** True when this app is currently the OS handler for the `http` scheme. */
  http: boolean;
  /** True when this app is currently the OS handler for the `https` scheme. */
  https: boolean;
  /** True only when the app owns BOTH http and https. */
  isDefault: boolean;
  /** False in unpackaged dev runs, where OS registration is unreliable. */
  isPackaged: boolean;
  /** `process.platform`. */
  platform: string;
}

export interface DefaultBrowserApi {
  /**
   * Drain URLs captured before a renderer was ready to receive them (cold
   * start launched by a link). Returns and clears the queue; callers open each
   * URL. Warm-path URLs arrive over `link:open` instead.
   */
  consumePending: () => Promise<{ urls: string[] }>;
}
