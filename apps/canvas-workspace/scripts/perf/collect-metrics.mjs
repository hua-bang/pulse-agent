#!/usr/bin/env node
/**
 * Normalize the latest perf reports (bundle + scenarios) into the recording
 * schema from perf/program.md §3, write perf/out/metrics-latest.json, and
 * append a copy to perf/history/ (per-machine trend data, not committed).
 *
 * Missing reports are fine — the dashboard renders absent metrics as 未建.
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname, platform, cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(appRoot, 'perf/out');

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : null);

export const collectInteractionScenarioMetrics = (scenarios, name) => {
  const report = scenarios?.scenarios?.[name]?.report;
  const entries = [];
  const add = (id, value, extra = {}) => {
    if (value === undefined || value === null || Number.isNaN(value)) return;
    entries.push({ id, value, runs: 1, ...extra });
  };
  if (report) {
    const repeatExtra = report.runs > 1
      ? { runs: report.runs, raw: report.raw?.interactionsP95 }
      : {};
    const frameExtra = report.runs > 1
      ? { runs: report.runs, raw: report.raw?.framesOver20Pct }
      : {};
    add(`interact.${name}.inp_p95_ms`, report.interactions.p95, repeatExtra);
    add(`interact.${name}.frames_over20_pct`, report.frames.over20msPct, frameExtra);
  }
  for (const counter of ['nodes-array-replace', 'canvas-save-ipc']) {
    const gate = scenarios?.gates?.find((entry) => entry.scenario === name && entry.counter === counter);
    const value = report?.counters?.[counter];
    const id = `interact.${name}.counter.${counter.replaceAll('-', '_')}`;
    const counterExtra = report?.runs > 1
      ? {
          runs: report.runs,
          raw: report.raw?.counters?.map((run) => run[counter] ?? 0),
        }
      : {};
    if (typeof value === 'number') {
      add(id, value, {
        ...counterExtra,
        ...(gate ? {
          pass: gate.pass,
          limit: gate.max,
          ...(gate.missingConfig ? { missingConfig: true } : {}),
        } : {}),
      });
    } else if (gate) {
      entries.push({
        id,
        value: typeof gate.value === 'number' ? gate.value : null,
        runs: 1,
        ...counterExtra,
        pass: gate.pass,
        limit: gate.max,
        ...(gate.missing ? { missing: true } : {}),
        ...(gate.missingConfig ? { missingConfig: true } : {}),
      });
    }
  }
  return entries;
};

export const collectMetrics = () => {
  const bundle = readJson(join(outDir, 'bundle-report.json'));
  const scenarios = readJson(join(outDir, 'scenarios-report.json'));
  const metrics = [];
  const push = (id, value, extra = {}) => {
    if (value === undefined || value === null || Number.isNaN(value)) return;
    metrics.push({ id, value, runs: 1, ...extra });
  };

  if (bundle) {
    const gateFor = (name) => bundle.gates?.find((g) => g.metric === name);
    for (const [reportKey, id] of [
      ['entryRawKB', 'bundle.entry_raw_kb'],
      ['entryGzipKB', 'bundle.entry_gzip_kb'],
      ['totalJsKB', 'bundle.total_js_kb'],
    ]) {
      const gate = gateFor(reportKey);
      push(id, bundle.metrics[reportKey], gate ? { pass: gate.pass, limit: gate.limit } : {});
    }
    push('bundle.chunk_count', bundle.metrics.chunkCount);
    push('bundle.heavy_in_entry_count', bundle.probes.filter((p) => p.inEntry).length, {
      detail: bundle.probes.filter((p) => p.inEntry).map((p) => p.lib).join(' · '),
    });
    // bundle.lazy_boundary_watchlist: passes iff EVERY watched lib is out of
    // the entry chunk. All six probe libs are lazied as of C2/C3/C7/chain-B
    // (2026-07-05); the static-import graph test (bundle-boundaries.test.ts
    // WATCHLIST) gates the same boundaries at source level, this probe gates
    // them at built-output level.
    const WATCHED_LIBS = [
      'mermaid',
      'force-graph (d3-force)',
      'xterm',
      'highlight.js',
      'module-federation runtime',
      'tiptap/prosemirror',
    ];
    const watched = WATCHED_LIBS.map((lib) => bundle.probes.find((p) => p.lib.startsWith(lib)));
    const watchlistPass = watched.every((p) => p && !p.inEntry);
    const regressed = watched.filter((p) => p && p.inEntry).map((p) => p.lib);
    push('bundle.lazy_boundary_watchlist', watchlistPass, {
      pass: watchlistPass,
      ...(regressed.length ? { detail: regressed.join(' · ') } : {}),
    });
  }

  const phases = scenarios?.scenarios?.startup?.mainPhases;
  if (phases) {
    // A3: report.mjs's --repeat boots the app N times and folds the phase
    // marks into a same-machine median (mergeStartupMedians); runs/raw ride
    // along when present so history keeps the sample count, not just the
    // point value. Absent when run-scenarios.mjs is invoked standalone
    // (single boot) — runs defaults to 1 in that case.
    const phasesRuns = scenarios.scenarios.startup.mainPhasesRuns;
    const phasesRaw = scenarios.scenarios.startup.mainPhasesRaw;
    const extra = (field) => (phasesRuns > 1 ? { runs: phasesRuns, raw: phasesRaw?.[field] } : {});
    push('startup.when_ready_ms', phases.whenReady, extra('whenReady'));
    push('startup.open_window_ms', phases.openWindow, extra('openWindow'));
    push('startup.dom_ready_ms', phases.rendererDomReady, extra('rendererDomReady'));
    if (phases.pluginsActivated !== undefined) {
      const serialChainExtra = phasesRuns > 1 && phasesRaw?.pluginsActivated && phasesRaw?.whenReady
        ? { runs: phasesRuns, raw: phasesRaw.pluginsActivated.map((v, i) => v - phasesRaw.whenReady[i]) }
        : {};
      push('startup.serial_chain_ms', phases.pluginsActivated - phases.whenReady, serialChainExtra);
    }
  }
  const paint = scenarios?.scenarios?.startup?.paint;
  if (paint?.['first-contentful-paint']) {
    push('startup.renderer.fcp_ms', Math.round(paint['first-contentful-paint']));
  }
  const rendererMarks = scenarios?.scenarios?.startup?.rendererMarks;
  if (rendererMarks?.['renderer:main-start'] != null) {
    // performance.now() at main.tsx's first statement ≈ entry chunk V8
    // compile + eval up to that point (the mark is set at module load).
    push('startup.renderer.entry_eval_ms', Math.round(rendererMarks['renderer:main-start']));
  }

  const mainProc = scenarios?.scenarios?.main;
  if (mainProc) {
    push('main.loop_delay_p99_ms', mainProc.loopDelayP99Ms, {
      detail: `${mainProc.windows} 个 2s 窗口的最差 p99`,
    });
    push('main.loop_delay_max_ms', mainProc.loopDelayMaxMs);
    push('main.canvas_save.files_written', mainProc.canvasSaveFilesWritten);
    if (mainProc.sessionPersistBytes != null) {
      push('main.session_persist.bytes_per_turn', Math.round(mainProc.sessionPersistBytes / 1024));
    }
    if (mainProc.peakRssKb != null) {
      push('memory.n100.total_rss_mb', Math.round(mainProc.peakRssKb / 1024), {
        detail: 'run-peak across loop-delay windows (incl ws-cycle; 100-node isolation TODO)',
      });
    }
  }

  const wsc = scenarios?.scenarios?.['ws-cycle'];
  if (wsc) {
    push('memory.ws_cycle.heap_slope', wsc.heapSlopeMB, {
      detail: `${wsc.workspaces} workspaces · heap ${wsc.heapsMB?.join(' → ')} MB`,
    });
    push('memory.ws_cycle.peak_heap_mb', wsc.peakHeapMB);
  }

  for (const name of ['typing', 'drag', 'resize']) {
    // A3: --repeat N folds multiple in-session runs into a median (see
    // run-scenarios.mjs aggregateReports); runs/raw follow the schema in
    // program.md §3 so history entries carry sample counts, not just values.
    metrics.push(...collectInteractionScenarioMetrics(scenarios, name));
  }

  // A4: panzoom has no nodes-array-replace counter (pan/zoom never touch
  // the nodes array), so it gets its own small push instead of joining the
  // typing/drag counter loop above. Honest limitation: wheel/scroll events
  // are not part of the Event Timing API's discrete-interaction set (per
  // spec — only pointerdown/up, click, keydown/up, etc. get an
  // interactionId), so inp_p95_ms structurally reads 0 for a wheel-driven
  // gesture regardless of real cost — it's recorded (not gated) for that
  // reason. frames_over20_pct is the metric that actually carries signal
  // here (rAF frame-delta tracking, independent of interactionId).
  const panzoomReport = scenarios?.scenarios?.panzoom?.report;
  if (panzoomReport) {
    const panzoomExtra = panzoomReport.runs > 1
      ? { runs: panzoomReport.runs, raw: panzoomReport.raw?.interactionsP95 }
      : {};
    const panzoomFrameExtra = panzoomReport.runs > 1
      ? { runs: panzoomReport.runs, raw: panzoomReport.raw?.framesOver20Pct }
      : {};
    push('interact.panzoom.inp_p95_ms', panzoomReport.interactions.p95, panzoomExtra);
    push('interact.panzoom.frames_over20_pct', panzoomReport.frames.over20msPct, panzoomFrameExtra);
  }

  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: appRoot, encoding: 'utf-8' }).trim();
  } catch { /* not a git checkout */ }

  return {
    commit,
    timestamp: new Date().toISOString(),
    machineId: createHash('sha256').update(hostname()).digest('hex').slice(0, 8),
    env: { os: platform(), cores: cpus().length, seedNodes: scenarios?.seedNodes },
    metrics,
  };
};

// History appending lives in dashboard.mjs (the main entry) so standalone
// collect runs don't create duplicate history entries for the same data.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const snapshot = collectMetrics();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'metrics-latest.json'), JSON.stringify(snapshot, null, 2));
  console.log(`[perf:collect] ${snapshot.metrics.length} metrics → perf/out/metrics-latest.json`);
}
