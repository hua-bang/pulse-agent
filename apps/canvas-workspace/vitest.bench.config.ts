import { defineConfig } from 'vitest/config';

// Microbenchmarks for pure hot-path functions. Node environment only — these
// must not pull in Electron, node-pty, xterm, or the DOM, so they stay
// CI-runnable and deterministic. Run with: pnpm bench
export default defineConfig({
  test: {
    environment: 'node',
    benchmark: {
      include: ['src/**/__bench__/**/*.bench.ts'],
      // The orchestrator (scripts/perf/report.mjs) passes --outputJson to
      // collect results; this is the default location when run directly.
      outputJson: 'perf/out/bench.json',
    },
  },
});
