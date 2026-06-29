import { promises as fs } from 'node:fs';
import { join, dirname } from 'node:path';
import { parseArgs } from './args.mjs';
import { APP_DIR } from './config.mjs';
import { evaluateRenderer } from './renderer.mjs';
import { printResult } from './output.mjs';
import { startCommand } from './launch.mjs';
import { clearCurrentSession, readSession, requireLiveSession, stopSession } from './session.mjs';
import { isPidAlive } from './utils.mjs';

// ── L4 runtime profiling ────────────────────────────────────────────────────
//
// Drives a self-contained measurement probe in the renderer (via CDP
// Runtime.evaluate) for each scenario, capturing frame timing, long tasks,
// JS heap delta, and per-process metrics (from the perf plugin). Writes
// perf/out/runtime.json, which `scripts/perf/report.mjs` folds into the
// snapshot.
//
// Requires a live harness session: `pnpm --filter canvas-workspace harness
// start` first (open a heavy workspace for representative numbers). Each
// scenario must finish within the CDP call timeout (~15s), so duration is
// capped at 10s.

// Renderer-side probe. Serialized with String() and invoked with JSON params.
// Returns a Promise resolving to a plain metrics object.
const RUNTIME_PROBE = String(function runtimeProbe(params) {
  const { scenario, durationMs } = params;
  return new Promise((resolve) => {
    const frameTimes = [];
    let longTasks = 0;
    let observer = null;
    try {
      observer = new PerformanceObserver((list) => {
        longTasks += list.getEntries().length;
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch (err) {
      // longtask unsupported — counter stays 0
    }

    const heapMB = () => {
      const mem = performance.memory;
      return mem ? Math.round((mem.usedJSHeapSize / 1024 / 1024) * 10) / 10 : null;
    };
    const heapStartMB = heapMB();

    const target =
      document.querySelector('.canvas-transform') ||
      document.querySelector('[class*="canvas"]') ||
      document.body;

    const pct = (arr, p) => {
      if (!arr.length) return 0;
      const sorted = arr.slice().sort((a, b) => a - b);
      const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
      return Math.round(sorted[idx] * 10) / 10;
    };

    let last = performance.now();
    const start = last;
    let dir = 1;

    const finish = async () => {
      if (observer) {
        try {
          observer.disconnect();
        } catch (err) {
          // ignore
        }
      }
      let processMetrics = null;
      try {
        processMetrics = await window.canvasWorkspace.plugin.invoke('perf', 'metrics');
      } catch (err) {
        // perf plugin inactive — leave null
      }
      const intervals = frameTimes.slice(1); // drop the first (warm-up) frame
      const totalMs = intervals.reduce((a, b) => a + b, 0);
      resolve({
        scenario,
        durationMs,
        frames: intervals.length,
        fps: totalMs > 0 ? Math.round((intervals.length / totalMs) * 1000) : 0,
        frameMsP50: pct(intervals, 0.5),
        frameMsP95: pct(intervals, 0.95),
        frameMsMax: intervals.length ? Math.round(Math.max.apply(null, intervals) * 10) / 10 : 0,
        longTasks,
        heapStartMB,
        heapEndMB: heapMB(),
        processMetrics,
      });
    };

    const frame = (now) => {
      frameTimes.push(now - last);
      last = now;
      if (scenario === 'pan-zoom' && target) {
        // Synthetic zoom via ctrl+wheel; flips direction periodically so the
        // viewport oscillates rather than running off. Fidelity depends on the
        // canvas honoring synthetic wheel events.
        target.dispatchEvent(
          new WheelEvent('wheel', { deltaY: 16 * dir, ctrlKey: true, bubbles: true, cancelable: true }),
        );
        if (frameTimes.length % 24 === 0) dir *= -1;
      }
      if (now - start < durationMs) {
        requestAnimationFrame(frame);
      } else {
        void finish();
      }
    };

    requestAnimationFrame(frame);
  });
});

const SCENARIOS = ['idle', 'pan-zoom'];

export async function perfRuntimeCommand(rawArgs) {
  const { opts } = parseArgs(rawArgs);
  const durationMs = Math.min(Math.max(Number(opts.duration ?? 4000), 500), 10_000);
  const which =
    opts.scenario && opts.scenario !== 'all' ? [String(opts.scenario)] : SCENARIOS;

  // Session management: reuse a live session if one exists; otherwise spin up an
  // ephemeral one, profile against it, and tear it down — so a single command
  // does the whole thing. `--start` forces a fresh session even if one is live;
  // `--keep` leaves a self-started session running.
  const existing = await readSession().catch(() => null);
  const haveLive = existing && isPidAlive(existing.pid);
  let startedHere = false;

  if (opts.start || !haveLive) {
    const startArgs = ['--profile', String(opts.profile ?? 'demo'), '--force'];
    if (opts.build) startArgs.push('--build');
    process.stderr.write('› no live harness session — launching an ephemeral one…\n');
    await startCommand(startArgs);
    startedHere = true;
  }

  const session = await requireLiveSession();
  try {
    const scenarios = [];
    for (const scenario of which) {
      const expr = `(${RUNTIME_PROBE})(${JSON.stringify({ scenario, durationMs })})`;
      // eslint-disable-next-line no-await-in-loop
      const result = await evaluateRenderer(session, expr);
      scenarios.push(result);
    }

    const out = {
      generatedAt: new Date().toISOString(),
      profile: session.profile,
      durationMs,
      scenarios,
    };
    const outPath = join(APP_DIR, 'perf', 'out', 'runtime.json');
    await fs.mkdir(dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, `${JSON.stringify(out, null, 2)}\n`);

    printResult(opts.json, out, [
      `Runtime profile (${session.profile}) → perf/out/runtime.json`,
      ...scenarios.map(
        (r) =>
          `  ${r.scenario}: ${r.fps} fps · frame p95 ${r.frameMsP95}ms · max ${r.frameMsMax}ms · longTasks ${r.longTasks} · heap ${r.heapStartMB}→${r.heapEndMB}MB`,
      ),
    ]);
  } finally {
    if (startedHere && !opts.keep) {
      await stopSession(session, { cleanup: session.cleanupHome }).catch(() => {});
      await clearCurrentSession().catch(() => {});
      process.stderr.write('› ephemeral harness session closed.\n');
    }
  }
}
