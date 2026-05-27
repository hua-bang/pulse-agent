/**
 * Shared types for the datasource plugin.
 *
 * A "datasource node" lives on a canvas and shows live data. The plugin
 * splits responsibilities cleanly:
 *
 *   datasource (fetcher + optional transform)
 *     ─ pure data engine. Owns a fetcher loop, applies a transform, and
 *       publishes shaped values as JSON. Exposed at:
 *         GET /api/<id>          → latest snapshot
 *         GET /api/<id>/stream   → SSE of every shaped value
 *
 *   ui (LLM-authored html / script / css)
 *     ─ iframe page that subscribes to the SSE endpoint and renders
 *       however the LLM wrote it. The framework wraps the body in a
 *       minimal document and exposes the SSE URL as
 *       `window.__ENDPOINT__`.
 *
 * The iframe canvas node loads /ui/<id>.
 */

export interface HttpPollFetcher {
  type: "http_poll";
  url: string;
  /** Poll interval in milliseconds. */
  interval: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  /** Stringified or JSON-serialisable body for POST. */
  body?: unknown;
}

/**
 * Synthetic data source — no network, no external API. Used for demos,
 * dev fixtures, and end-to-end tests of the pipeline.
 */
export interface MockFetcher {
  type: "mock";
  /** Tick interval in milliseconds. */
  interval: number;
  scenario: "random_walk" | "counter";
  /** random_walk: starting value (default 100). */
  initial?: number;
  /** random_walk: per-tick relative volatility (default 0.01 = 1%). */
  volatility?: number;
}

// Discriminated union — add 'sse', 'ws', 'mcp_subscribe' etc. as siblings.
export type Fetcher = HttpPollFetcher | MockFetcher;

export interface TransformSpec {
  /**
   * Function body. `input` global holds the fetched value; must
   * `return` the shaped output. Runs in a vm sandbox — no fetch /
   * require / process / Buffer. Sync only, 1s timeout.
   */
  code: string;
}

/**
 * Hand-written iframe page. The renderer wraps `html` in a minimal
 * document, injects `script` (after DOM ready), and sets
 * `window.__ENDPOINT__` to the SSE stream URL.
 */
export interface UiSpec {
  html: string;
  script?: string;
  css?: string;
}

export interface DatasourceSpec {
  fetcher: Fetcher;
  transform?: TransformSpec;
  ui: UiSpec;
}
