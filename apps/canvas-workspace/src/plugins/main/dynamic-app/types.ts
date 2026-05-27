/**
 * Shared types for the dynamic-app plugin.
 *
 * A "dynamic app" is a live, server-backed iframe node on the canvas.
 * Two kinds:
 *
 *   polling
 *     ─ pull from external source on a schedule. Read-only from the
 *       iframe's POV. `fetcher` defines how data arrives; optional
 *       `transform` shapes it; `ui` renders it.
 *
 *   stateful
 *     ─ owns its own state (todos, notes, counters, forms). User-driven
 *       mutations via POST /api/<id>/actions/<name>. State persists to
 *       disk; survives restart. `state.initial` is the seed; `actions`
 *       are LLM-authored `(state, input) => newState` reducers.
 *
 * Three HTTP routes per app regardless of kind:
 *   GET  /api/<id>                   → latest payload (one-shot snapshot)
 *   POST /api/<id>/actions/<name>    → run action, return new state
 *                                       (stateful only)
 *   GET  /api/<id>/stream            → SSE of payload changes
 *
 * The iframe loads /ui/<id> and picks how to consume the payload:
 * fetch + POST for purely interactive (no SSE connection),
 * EventSource for live updates, or both.
 */

export interface HttpPollFetcher {
  type: "http_poll";
  url: string;
  /** Poll interval in milliseconds. */
  interval: number;
  headers?: Record<string, string>;
  method?: "GET" | "POST";
  body?: unknown;
}

/**
 * Synthetic data source — no network, no external API.
 */
export interface MockFetcher {
  type: "mock";
  interval: number;
  scenario: "random_walk" | "counter";
  initial?: number;
  volatility?: number;
}

export type Fetcher = HttpPollFetcher | MockFetcher;

export interface TransformSpec {
  /**
   * Function body. `input` global holds the fetched value; must
   * `return` the shaped output. Sync only, 1s timeout, no I/O.
   */
  code: string;
}

export interface ActionSpec {
  /**
   * Function body. Has `state` and `input` as globals; must `return`
   * the new state. Sync only, 1s timeout, no I/O. The new state is
   * persisted to disk and broadcast to every SSE client; the POST
   * response also returns it.
   */
  code: string;
}

export interface UiSpec {
  html: string;
  script?: string;
  css?: string;
}

export interface PollingSpec {
  kind: "polling";
  fetcher: Fetcher;
  transform?: TransformSpec;
  ui: UiSpec;
}

export interface StatefulSpec {
  kind: "stateful";
  /** Seed payload. Only used the first time a runner starts and no
   *  state file exists yet; subsequent restarts load the persisted
   *  state instead. */
  state: { initial: unknown };
  /** Action name → reducer. Names appear in window.__ACTIONS__ on
   *  the iframe side, mapped to POST endpoints. */
  actions: Record<string, ActionSpec>;
  ui: UiSpec;
}

export type DynamicAppSpec = PollingSpec | StatefulSpec;
