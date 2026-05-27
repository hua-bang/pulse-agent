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
 *       Same datasource can drive multiple presentations.
 *
 *   presentation
 *     ─ how the data shows up in an iframe. Two flavours:
 *         inline_html: LLM writes raw html/script/css; we wrap it in a
 *                      page that exposes the SSE endpoint as
 *                      window.__ENDPOINT__.
 *         template:    pick a pre-built HTML template by name and
 *                      provide params. Template code lives in
 *                      `templates/`; renderer composes the final HTML.
 *
 * The iframe canvas node loads /ui/<id>; that route dispatches on
 * presentation.type to render the appropriate HTML body.
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
export interface InlineHtmlPresentation {
  type: "inline_html";
  html: string;
  script?: string;
  css?: string;
}

/**
 * Pick a pre-built HTML template by name and provide its params.
 * Template definitions live in `templates/`; params are validated
 * against the template's Zod schema before render.
 */
export interface TemplatePresentation {
  type: "template";
  /** Registry key — e.g. 'big_number', 'line_chart'. */
  template: string;
  /** Template-specific params; validated by the template's schema. */
  params: Record<string, unknown>;
}

export type PresentationSpec = InlineHtmlPresentation | TemplatePresentation;

export interface DatasourceSpec {
  fetcher: Fetcher;
  transform?: TransformSpec;
  presentation: PresentationSpec;
}
