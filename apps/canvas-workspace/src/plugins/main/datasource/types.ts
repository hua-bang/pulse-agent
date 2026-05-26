/**
 * Shared types for the datasource plugin.
 *
 * A "datasource node" lives on a canvas and shows live data. The plugin
 * persists a spec, forks a child process that owns a small HTTP/SSE
 * server, and points an iframe canvas node at `http://localhost:<port>/`.
 *
 * Spec shape (decided in conversation):
 *   - fetcher: HOW data arrives. Declarative; framework owns side effects.
 *     Polling is just ONE type; sse/ws/mcp variants slot in later via the
 *     `Fetcher` union without touching transform/ui or the wire protocol.
 *   - transform: optional pure JS `(input) => output`. Runs in pulse-sandbox.
 *   - ui: html/script/css concatenated into the page the iframe loads.
 *     The page connects to `/stream` (SSE) and receives every shaped value.
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

// Discriminated union — add 'sse', 'ws', 'mcp_subscribe' etc. as siblings.
export type Fetcher = HttpPollFetcher;

export interface TransformSpec {
  /**
   * Function body. Has access to a `input` global (the fetched value)
   * and must `return` the shaped output. Runs in pulse-sandbox: no
   * fetch / require / process / Buffer.
   *
   * Example: `return { stars: input.stargazers_count };`
   */
  code: string;
}

export interface UiSpec {
  /** Body markup. Wrapped inside the served HTML page. */
  html: string;
  /** JS that runs after DOM ready. Receives `__ENDPOINT__` global. */
  script?: string;
  /** Optional CSS rules. */
  css?: string;
}

export interface DatasourceSpec {
  fetcher: Fetcher;
  transform?: TransformSpec;
  ui: UiSpec;
}

// ─── child ↔ parent messages ───────────────────────────────────────

export interface ChildInitMessage {
  type: "init";
  spec: DatasourceSpec;
}

export interface ChildReadyMessage {
  type: "ready";
  port: number;
}

export interface ChildErrorMessage {
  type: "error";
  message: string;
}

export type ChildToParentMessage = ChildReadyMessage | ChildErrorMessage;
