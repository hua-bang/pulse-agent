/**
 * Main-process event-loop delay sampler.
 *
 * The main process serves every IPC on a single event loop, so any sync I/O,
 * large JSON parse, or O(n²) there stalls the whole app. This samples the loop
 * delay (perf_hooks histogram, near-zero overhead) and logs a parseable line
 * per window that the harness reads to derive `main.loop_delay_p99_ms` /
 * `_max_ms`. Guards the E/J-dimension findings.
 *
 * Off by default — only active when PULSE_CANVAS_PERF is set (the perf harness
 * launch sets it), so normal runs pay nothing.
 */
import { app } from 'electron';
import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';

const SAMPLE_WINDOW_MS = 2000;
const NS_PER_MS = 1_000_000;

let timer: ReturnType<typeof setInterval> | null = null;
let histogram: IntervalHistogram | null = null;

export const startLoopDelaySampler = (
  writeLog: (scope: string, message: string, detail?: string) => unknown,
): void => {
  if (!process.env.PULSE_CANVAS_PERF || timer) return;
  histogram = monitorEventLoopDelay({ resolution: 10 });
  histogram.enable();
  timer = setInterval(() => {
    if (!histogram) return;
    const summary = {
      p99: Math.round((histogram.percentile(99) / NS_PER_MS) * 10) / 10,
      max: Math.round((histogram.max / NS_PER_MS) * 10) / 10,
      mean: Math.round((histogram.mean / NS_PER_MS) * 10) / 10,
      // App-wide RSS (sum across all Electron processes) for the memory
      // aspect. Run-peak over all windows — an upper bound; a clean 100-node
      // single-workspace sample needs scenario-level isolation (TODO).
      rssKb: app.getAppMetrics().reduce((sum, m) => sum + (m.memory?.workingSetSize ?? 0), 0),
    };
    histogram.reset();
    // Each window is independent; the harness aggregates across the run.
    const line = JSON.stringify(summary);
    console.log(`[perf] loop-delay ${line}`);
    void writeLog('perf', 'loop-delay', line);
  }, SAMPLE_WINDOW_MS);
  if (typeof timer.unref === 'function') timer.unref();
};

export const stopLoopDelaySampler = (): void => {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  histogram?.disable();
  histogram = null;
};
