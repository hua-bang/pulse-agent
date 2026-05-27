/**
 * `mock` runner — emits synthetic data on a fixed interval. No network,
 * no external API, no surprises. Used to validate the SSE → iframe path
 * without depending on a public endpoint.
 *
 * Scenarios:
 *   - counter: { tick, ts }, tick incrementing from 1.
 *   - random_walk: { value, ts }, value following a multiplicative
 *     random walk from `initial` with `volatility` per tick. Useful for
 *     stock-price-shaped fixtures.
 */

import type { MockFetcher } from "../types";
import type { RunnerEvents, RunnerHandle } from "./http-poll";

const MIN_INTERVAL_MS = 250;

export function startMock(
  spec: MockFetcher,
  events: RunnerEvents,
): RunnerHandle {
  const interval = Math.max(MIN_INTERVAL_MS, spec.interval);
  let cancelled = false;
  let timer: NodeJS.Timeout | undefined;

  let tickCount = 0;
  let walkValue = spec.initial ?? 100;
  const volatility = spec.volatility ?? 0.01;

  const tick = (): void => {
    if (cancelled) return;
    tickCount += 1;
    let payload: unknown;
    switch (spec.scenario) {
      case "counter":
        payload = { tick: tickCount, ts: Date.now() };
        break;
      case "random_walk": {
        // Symmetric per-tick relative move in [-volatility, +volatility].
        // Multiplicative so the series stays positive and looks priced.
        const change = (Math.random() - 0.5) * 2 * volatility;
        walkValue = Math.max(0, walkValue * (1 + change));
        payload = {
          value: Math.round(walkValue * 100) / 100,
          ts: Date.now(),
        };
        break;
      }
      default:
        events.onError(
          new Error(
            `mock: unknown scenario "${(spec as { scenario?: string }).scenario}"`,
          ),
        );
        return;
    }
    events.onData(payload);
  };

  // Fire immediately so the first sample lands without a full interval delay.
  tick();
  timer = setInterval(tick, interval);

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
