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
    const mermaid = bundle.probes.find((p) => p.lib.startsWith('mermaid'));
    if (mermaid) push('bundle.lazy_boundary_watchlist', !mermaid.inEntry, { pass: !mermaid.inEntry });
  }

  const phases = scenarios?.scenarios?.startup?.mainPhases;
  if (phases) {
    push('startup.when_ready_ms', phases.whenReady);
    push('startup.open_window_ms', phases.openWindow);
    push('startup.dom_ready_ms', phases.rendererDomReady);
    if (phases.pluginsActivated !== undefined) {
      push('startup.serial_chain_ms', phases.pluginsActivated - phases.whenReady);
    }
  }
  const paint = scenarios?.scenarios?.startup?.paint;
  if (paint?.['first-contentful-paint']) {
    push('startup.renderer.fcp_ms', Math.round(paint['first-contentful-paint']));
  }

  const mainProc = scenarios?.scenarios?.main;
  if (mainProc) {
    push('main.loop_delay_p99_ms', mainProc.loopDelayP99Ms, {
      detail: `${mainProc.windows} 个 2s 窗口的最差 p99`,
    });
    push('main.loop_delay_max_ms', mainProc.loopDelayMaxMs);
  }

  const wsc = scenarios?.scenarios?.['ws-cycle'];
  if (wsc) {
    push('memory.ws_cycle.heap_slope', wsc.heapSlopeMB, {
      detail: `${wsc.workspaces} workspaces · heap ${wsc.heapsMB?.join(' → ')} MB`,
    });
    push('memory.ws_cycle.peak_heap_mb', wsc.peakHeapMB);
  }

  for (const name of ['typing', 'drag']) {
    const report = scenarios?.scenarios?.[name]?.report;
    if (!report) continue;
    push(`interact.${name}.inp_p95_ms`, report.interactions.p95);
    push(`interact.${name}.frames_over20_pct`, report.frames.over20msPct);
    for (const [counter, id] of [
      ['nodes-array-replace', `interact.${name}.counter.nodes_array_replace`],
      ['canvas-save-ipc', `interact.${name}.counter.canvas_save_ipc`],
    ]) {
      const gate = scenarios.gates?.find((g) => g.scenario === name && g.counter === counter);
      push(id, report.counters[counter] ?? 0, gate ? { pass: gate.pass, limit: gate.max } : {});
    }
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
