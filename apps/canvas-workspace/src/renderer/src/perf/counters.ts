/**
 * Deterministic domain counters for performance evaluation.
 *
 * Counters guard the known hot-path amplifiers from the performance reports
 * (docs/performance-analysis-*.md): whole nodes-array replacements, canvas
 * save IPC, chat markdown cache efficiency, terminal refits. Unlike timing
 * metrics they are noise-free, so harness scenarios can assert exact budgets.
 *
 * Disabled by default: `count()` is a single boolean check until a scenario
 * calls `setCountersEnabled(true)` (done by `__pulsePerf.begin()`).
 */

const counters = new Map<string, number>();
let enabled = false;

export const setCountersEnabled = (on: boolean): void => {
  enabled = on;
};

export const countersEnabled = (): boolean => enabled;

export const count = (name: string, by = 1): void => {
  if (!enabled) return;
  counters.set(name, (counters.get(name) ?? 0) + by);
};

export const snapshotCounters = (): Record<string, number> =>
  Object.fromEntries(counters);

export const resetCounters = (): void => {
  counters.clear();
};
