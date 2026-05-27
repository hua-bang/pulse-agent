/**
 * `http_poll` runner — periodically GETs/POSTs a URL and emits the
 * parsed JSON body. Used for the simplest "snapshot every N seconds"
 * polling apps. SSE / WebSocket / MCP-subscribe runners will sit
 * alongside this file later with the same `start()` shape.
 */

import type { HttpPollFetcher } from "../types";

export interface RunnerHandle {
  /** Stop the runner. Idempotent — safe to call multiple times. */
  stop(): void;
}

export interface RunnerEvents {
  /** Latest raw value from the source (pre-transform). */
  onData(value: unknown): void;
  /** Non-fatal error — runner keeps going. */
  onError(err: Error): void;
}

const MIN_INTERVAL_MS = 250;

export function startHttpPoll(
  spec: HttpPollFetcher,
  events: RunnerEvents,
): RunnerHandle {
  const interval = Math.max(MIN_INTERVAL_MS, spec.interval);
  let cancelled = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async (): Promise<void> => {
    if (cancelled) return;
    try {
      const res = await fetch(spec.url, {
        method: spec.method ?? "GET",
        headers: spec.headers,
        body:
          spec.body !== undefined && spec.method === "POST"
            ? typeof spec.body === "string"
              ? spec.body
              : JSON.stringify(spec.body)
            : undefined,
      });
      if (!res.ok) {
        events.onError(new Error(`http ${res.status} ${res.statusText}`));
        return;
      }
      const ct = res.headers.get("content-type") ?? "";
      const value = ct.includes("application/json")
        ? await res.json()
        : await res.text();
      if (!cancelled) events.onData(value);
    } catch (err) {
      if (!cancelled) {
        events.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };

  // Fire immediately so the first value lands without waiting one full
  // interval — important for UX of "open node → see number".
  void tick();
  timer = setInterval(() => void tick(), interval);

  return {
    stop() {
      cancelled = true;
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}
