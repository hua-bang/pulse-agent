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
import { arch, hostname, platform, cpus } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const outDir = join(appRoot, 'perf/out');

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) : null);

const frameEvidence = (report) => {
  const runs = report?.runs ?? 1;
  const raw = runs > 1 ? report.raw?.framesOver20Pct : undefined;
  const rawCounts = runs > 1 ? report.raw?.framesOver20Count : undefined;
  const median = report?.frames?.over20msPct;
  const maxPct = report?.frames?.over20msPctMax
    ?? (raw?.length ? Math.max(...raw) : median);
  const maxCount = report?.frames?.over20msCountMax
    ?? (rawCounts?.length ? Math.max(...rawCounts) : report?.frames?.over20msCount ?? 0);
  return {
    runs,
    raw,
    median,
    maxPct,
    maxCount,
    detail: `median ${median}% · max ${maxPct}% · max ${maxCount} frames >20ms`,
  };
};

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
    const frames = frameEvidence(report);
    add(`interact.${name}.inp_p95_ms`, report.interactions.p95, repeatExtra);
    add(`interact.${name}.frames_over20_pct`, frames.median, {
      ...(frames.runs > 1 ? { runs: frames.runs, raw: frames.raw } : {}),
      detail: frames.detail,
    });
    add(`interact.${name}.frames_over20_pct_max`, frames.maxPct, {
      ...(frames.runs > 1 ? { runs: frames.runs, raw: frames.raw } : {}),
      detail: `max across ${frames.runs} active-window runs · ${frames.maxCount} frames >20ms`,
    });
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

export const collectImageMemoryMetric = (scenarios) => {
  const imageMemory = scenarios?.scenarios?.['image-memory'];
  if (!imageMemory || typeof imageMemory.decodedMB !== 'number') return null;
  return {
    id: 'memory.image.decoded_mb',
    value: imageMemory.decodedMB,
    runs: 1,
    detail: `${imageMemory.images}×4K · original ${imageMemory.originalDecodedMB} MB · ${imageMemory.reductionRatio}× reduction`,
  };
};

export const collectChatStreamMetrics = (scenarios) => {
  const chatStream = scenarios?.scenarios?.['chat-stream'];
  if (!chatStream?.report) return [];
  const entries = [
    { id: 'chat.stream.frames_over20_pct', value: chatStream.report.frames.over20msPct, runs: 1 },
    { id: 'chat.stream.md_render_count', value: chatStream.markdownRenders, runs: 1 },
  ];
  const commitCount = chatStream.report.counters?.['chat-stream-commit'];
  if (Number.isFinite(commitCount)) {
    entries.push({ id: 'chat.stream.commit_count', value: commitCount, runs: 1 });
  }
  entries.push({ id: 'chat.stream.tail_burst_ms', value: chatStream.tailBurstMs, runs: 1 });
  const renderGate = scenarios.gates?.find(
    entry => entry.scenario === 'chat-stream' && entry.counter === 'chat-md-stream-render',
  );
  if (renderGate) {
    entries[1] = {
      ...entries[1],
      pass: renderGate.pass,
      limit: renderGate.max,
    };
  }
  const commitGate = scenarios.gates?.find(
    entry => entry.scenario === 'chat-stream' && entry.counter === 'chat-stream-commit',
  );
  const commitEntryIndex = entries.findIndex((entry) => entry.id === 'chat.stream.commit_count');
  if (commitGate && commitEntryIndex >= 0) {
    entries[commitEntryIndex] = {
      ...entries[commitEntryIndex],
      pass: commitGate.pass,
      limit: commitGate.max,
    };
  }
  const cacheProbe = chatStream.cacheProbe;
  const hits = cacheProbe?.hits;
  const renders = cacheProbe?.renders;
  const opportunities = cacheProbe?.opportunities;
  if (
    Number.isFinite(hits)
    && hits >= 0
    && Number.isFinite(renders)
    && renders >= 0
    && Number.isFinite(opportunities)
    && opportunities > 0
    && opportunities === hits + renders
    && hits <= opportunities
  ) {
    const ratio = Math.round((hits / opportunities) * 1000) / 10;
    entries.push({
      id: 'chat.stream.md_cache_hit_ratio',
      value: ratio,
      runs: 1,
      detail: `${hits} hits / ${opportunities} settled render opportunities`,
    });
    entries.push({ id: 'chat.stream.md_cache_hit_count', value: hits, runs: 1 });
    entries.push({ id: 'chat.stream.md_cache_opportunity_count', value: opportunities, runs: 1 });
  }
  return entries;
};

export const collectWelcomeWebviewMetric = (scenarios) => {
  const value = scenarios?.scenarios?.startup?.welcomeWebviewMs;
  return typeof value === 'number'
    ? { id: 'startup.welcome_webview_ms', value, runs: 1 }
    : null;
};

export const collectPtyStreamMetric = (scenarios) => {
  const ptyStream = scenarios?.scenarios?.['pty-stream'];
  if (!ptyStream || typeof ptyStream.ipcPerSec !== 'number') return null;
  return {
    id: 'main.pty.ipc_per_sec',
    value: ptyStream.ipcPerSec,
    runs: 1,
    detail: `${ptyStream.terminals} terminals · ${ptyStream.events} IPC events · ${ptyStream.durationMs} ms`,
  };
};

export const collectRendererTraceMetrics = (scenarios) => {
  const trace = scenarios?.scenarios?.['renderer-trace'];
  if (trace?.status !== 'measured') return [];
  const detail = `warm renderer reload · ${trace.capture?.urlScheme ?? 'unknown'}:// · ${trace.artifact?.path ?? 'trace unavailable'}`;
  const topShifts = trace.vitals?.topLayoutShifts ?? [];
  const shiftDetail = topShifts.length > 0
    ? topShifts.map((shift) => `${shift.value}@${shift.startTime}ms`).join(' · ')
    : 'no unexpected layout shifts observed';
  const longTaskDetail = `${trace.blocking?.longTaskCount ?? 0} tasks · total ${trace.blocking?.longTaskTotalMs ?? 0}ms · ${detail}`;
  return [
    {
      id: 'startup.renderer_reload.lcp_ms', value: trace.vitals?.lcpMs, runs: 1,
      detail: `${detail} · web.dev reference ${trace.vitals?.lcpRating ?? 'unavailable'}`,
    },
    {
      id: 'startup.renderer_reload.cls', value: trace.vitals?.cls, runs: 1,
      detail: `${detail} · web.dev reference ${trace.vitals?.clsRating ?? 'unavailable'}`,
    },
    {
      id: 'startup.renderer_reload.layout_shift_count',
      value: trace.vitals?.layoutShiftCount,
      runs: 1,
      detail: `${shiftDetail} · ${detail}`,
    },
    {
      id: 'startup.renderer_reload.blocking_time_to_canvas_ms',
      value: trace.blocking?.timeToCanvasMs,
      runs: 1,
      detail: `FCP ${trace.window?.fcpMs ?? 0}ms → canvas ${trace.window?.firstCanvasMs ?? 0}ms`,
    },
    {
      id: 'startup.renderer_reload.blocking_canvas_to_lcp_ms',
      value: trace.blocking?.timeCanvasToLcpMs,
      runs: 1,
      detail: `canvas ${trace.window?.firstCanvasMs ?? 0}ms → LCP ${trace.vitals?.lcpMs ?? 0}ms`,
    },
    {
      id: 'startup.renderer_reload.long_task_count',
      value: trace.blocking?.longTaskCount,
      runs: 1,
      detail: longTaskDetail,
    },
    {
      id: 'startup.renderer_reload.long_task_max_ms',
      value: trace.blocking?.longTaskMaxMs,
      runs: 1,
      detail: longTaskDetail,
    },
    {
      id: 'startup.loaded_to_canvas_kb',
      value: trace.resources?.loadedToCanvasKB,
      runs: 1,
      detail: `${trace.resources?.loadedToCanvasCount ?? 'unknown'} local resources completed by first Canvas · ${detail}`,
    },
    {
      id: 'startup.loaded_to_lcp_kb',
      value: trace.resources?.loadedToLcpKB,
      runs: 1,
      detail: `${trace.resources?.loadedToLcpCount ?? 'unknown'} local resources completed by LCP · ${detail}`,
    },
    { id: 'startup.renderer_reload.task_ms', value: trace.cpu?.taskMs, runs: 1, detail },
    { id: 'startup.renderer_reload.script_ms', value: trace.cpu?.scriptMs, runs: 1, detail },
    { id: 'startup.renderer_reload.recalc_style_ms', value: trace.cpu?.recalcStyleMs, runs: 1, detail },
    { id: 'startup.renderer_reload.layout_ms', value: trace.cpu?.layoutMs, runs: 1, detail },
  ].filter((entry) => typeof entry.value === 'number' && Number.isFinite(entry.value));
};

export const collectPanzoomMetrics = (scenarios) => {
  const report = scenarios?.scenarios?.panzoom?.report;
  if (!report?.transformChanged || !report.wheelToNextFrame) return [];
  const frames = frameEvidence(report);
  const runs = report.runs ?? 1;
  const wheelRaw = runs > 1 ? report.raw?.wheelToNextFrameP95 : undefined;
  const common = runs > 1 ? { runs, raw: wheelRaw } : { runs: 1 };
  const frameCommon = runs > 1 ? { runs, raw: frames.raw } : { runs: 1 };
  return [
    {
      id: 'interact.panzoom.wheel_to_next_frame_p95_ms',
      value: report.wheelToNextFrame.p95,
      ...common,
      detail: `${report.wheelToNextFrame.count} wheel samples${runs > 1 ? `/run × ${runs}` : ''} · transform verified`,
    },
    {
      id: 'interact.panzoom.frames_over20_pct',
      value: frames.median,
      ...frameCommon,
      detail: frames.detail,
    },
    {
      id: 'interact.panzoom.frames_over20_pct_max',
      value: frames.maxPct,
      ...frameCommon,
      detail: `max across ${frames.runs} active-window runs · ${frames.maxCount} frames >20ms`,
    },
  ].filter((entry) => typeof entry.value === 'number' && Number.isFinite(entry.value));
};

export const collectWorkspaceCycleMetrics = (scenarios) => {
  const cycle = scenarios?.scenarios?.['ws-cycle'];
  const mountedCapacity = 4;
  const finitePositiveArray = (values) => Array.isArray(values)
    && values.every((value) => Number.isFinite(value) && value > 0);
  const expectedTailLength = Number.isInteger(cycle?.workspaces)
    ? cycle.workspaces - mountedCapacity + 1
    : 0;
  if (
    !cycle
    || !Number.isInteger(cycle.workspaces)
    || cycle.workspaces < 8
    || !Number.isFinite(cycle.nodesPerWorkspace)
    || cycle.nodesPerWorkspace <= 0
    || !finitePositiveArray(cycle.heapsMB)
    || cycle.heapsMB.length !== cycle.workspaces
    || !finitePositiveArray(cycle.postCapacityHeapsMB)
    || cycle.postCapacityHeapsMB.length !== expectedTailLength
    || cycle.postCapacityHeapsMB.some(
      (value, index) => value !== cycle.heapsMB[mountedCapacity - 1 + index],
    )
    || !finitePositiveArray(cycle.mountedWorkspaceCounts)
    || cycle.mountedWorkspaceCounts.length !== cycle.workspaces
  ) return [];
  const entries = [];
  const add = (id, value, detail) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    entries.push({ id, value, runs: 1, ...(detail ? { detail } : {}) });
  };
  add(
    'memory.ws_cycle.post_capacity_heap_slope',
    cycle.heapSlopeMB,
    `${cycle.workspaces} equal-load workspaces × ${cycle.nodesPerWorkspace} nodes · post-capacity heap ${cycle.postCapacityHeapsMB?.join(' → ')} MB`,
  );
  add('memory.ws_cycle.peak_heap_mb', cycle.peakHeapMB);
  add('memory.ws_cycle.nodes_per_workspace', cycle.nodesPerWorkspace);
  add('memory.ws_cycle.post_capacity_sample_count', cycle.postCapacityHeapsMB?.length);
  if (Array.isArray(cycle.mountedWorkspaceCounts) && cycle.mountedWorkspaceCounts.length > 0) {
    add('memory.ws_cycle.peak_mounted_workspace_count', Math.max(...cycle.mountedWorkspaceCounts));
  }
  return entries;
};

export const collectMetrics = () => {
  const bundle = readJson(join(outDir, 'bundle-report.json'));
  const scenarios = readJson(join(outDir, 'scenarios-report.json'));
  const inferredRepeat = scenarios
    ? Math.max(
        scenarios.repeat ?? 1,
        scenarios.scenarios?.startup?.mainPhasesRuns ?? 1,
        ...Object.values(scenarios.scenarios ?? {}).map((scenario) => scenario?.report?.runs ?? 1),
      )
    : undefined;
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
      ['startupJsRawKB', 'bundle.startup_js_raw_kb'],
      ['startupJsGzipKB', 'bundle.startup_js_gzip_kb'],
      ['startupCssRawKB', 'bundle.startup_css_raw_kb'],
      ['startupCssGzipKB', 'bundle.startup_css_gzip_kb'],
      ['startupRequestCount', 'bundle.startup_request_count'],
      ['totalCssRawKB', 'bundle.total_css_raw_kb'],
      ['mainRawKB', 'bundle.main_raw_kb'],
      ['preloadRawKB', 'bundle.preload_raw_kb'],
    ]) {
      const gate = gateFor(reportKey);
      push(id, bundle.metrics[reportKey], gate ? { pass: gate.pass, limit: gate.limit } : {});
    }
    push('bundle.chunk_count', bundle.metrics.chunkCount);
    for (const feature of ['file', 'chat', 'terminal', 'graph', 'mermaid', 'mf']) {
      push(
        `bundle.feature_first_load.${feature}_raw_kb`,
        bundle.metrics.featureFirstLoad?.[feature]?.rawKB,
        bundle.metrics.featureFirstLoad?.[feature]
          ? { detail: `${bundle.metrics.featureFirstLoad[feature].requestCount} incremental requests` }
          : {},
      );
    }
    const heavyInEntry = bundle.probes.filter((p) => p.inEntry);
    push('bundle.heavy_in_entry_count', heavyInEntry.length, {
      detail: heavyInEntry.length > 0
        ? `${heavyInEntry.length}/${bundle.probes.length} probes · ${heavyInEntry.map((p) => p.lib).join(' · ')}`
        : `0/${bundle.probes.length} probes · all watched heavy libraries stay lazy`,
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
    // performance.now() at main.tsx's first statement is a renderer-start
    // milestone. It is not a true V8 compile/eval duration; the metric label
    // and program.md keep that distinction explicit.
    push('startup.renderer.entry_eval_ms', Math.round(rendererMarks['renderer:main-start']));
  }
  if (rendererMarks?.['canvas:first-render'] != null) {
    push('startup.renderer.first_canvas_ms', Math.round(rendererMarks['canvas:first-render']));
  }
  const welcomeWebviewMetric = collectWelcomeWebviewMetric(scenarios);
  if (welcomeWebviewMetric) metrics.push(welcomeWebviewMetric);
  metrics.push(...collectRendererTraceMetrics(scenarios));

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

  metrics.push(...collectWorkspaceCycleMetrics(scenarios));

  const ptyStreamMetric = collectPtyStreamMetric(scenarios);
  if (ptyStreamMetric) metrics.push(ptyStreamMetric);

  const imageMemoryMetric = collectImageMemoryMetric(scenarios);
  if (imageMemoryMetric) metrics.push(imageMemoryMetric);

  metrics.push(...collectChatStreamMetrics(scenarios));

  for (const name of ['typing', 'drag', 'resize']) {
    // A3: --repeat N folds multiple in-session runs into a median (see
    // run-scenarios.mjs aggregateReports); runs/raw follow the schema in
    // program.md §3 so history entries carry sample counts, not just values.
    metrics.push(...collectInteractionScenarioMetrics(scenarios, name));
  }

  metrics.push(...collectPanzoomMetrics(scenarios));

  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: appRoot, encoding: 'utf-8' }).trim();
  } catch { /* not a git checkout */ }

  return {
    commit,
    timestamp: new Date().toISOString(),
    machineId: createHash('sha256').update(hostname()).digest('hex').slice(0, 8),
    env: {
      os: platform(),
      arch: arch(),
      cores: cpus().length,
      seedNodes: scenarios?.seedNodes,
      seedWebpages: scenarios?.seedWebpages,
      repeat: inferredRepeat,
      fixtureVersion: scenarios?.fixtureVersion,
      headless: scenarios?.session?.headless,
    },
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
