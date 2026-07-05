#!/usr/bin/env node
/**
 * Phase-B runtime scenario benchmarks, driven through the app harness.
 *
 * Prereq: a live harness session (the app already running):
 *   pnpm --filter canvas-workspace build
 *   node harness/cli.mjs start --profile temp        # DISPLAY required (xvfb ok)
 *   pnpm --filter canvas-workspace perf:scenarios [--seed-nodes 100]
 *
 * Scenarios (all metrics come from window.__pulsePerf + startup log line):
 *   startup  – main-process phase marks + renderer first-frame/canvas marks + FCP
 *   typing   – types into the first file node; guards I-1 via the
 *              nodes-array-replace counter (today: ≈1 replacement per keystroke)
 *   drag     – drags the first node by its header; guards A2 via the same
 *              counter (today: ≈1 replacement per pointer-move)
 *
 * Counter gates compare against perf/baselines.json → "runtime". Timing
 * metrics (INP p95, frame stats) are recorded as informational until enough
 * runs exist to set tolerances. Exit 1 on counter-gate failure.
 *
 * `--repeat N` (A3): typing/drag are re-driven N times against the same live
 * session (each iteration resets via __pulsePerf.begin/end); the reported
 * interactions.p95 / frames.over20msPct become the median across runs (raw[]
 * kept alongside) so a single noisy sample can't misfire the dashboard's
 * same-machine variance alert. Counters take the max across runs — they're
 * deterministic, so max is a safety net against a single-run undercount
 * rather than a smoothing choice.
 */
import { promises as fs } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireLiveSession } from '../../harness/src/session.mjs';
import { withPage } from '../../harness/src/cdp.mjs';
import { waitFor } from '../../harness/src/utils.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baselinesPath = join(appRoot, 'perf/baselines.json');
const outDir = join(appRoot, 'perf/out');

const args = process.argv.slice(2);
const readFlag = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};
const seedNodes = Number(readFlag('--seed-nodes') ?? 0);
const only = (readFlag('--scenario') ?? 'startup,typing,drag,panzoom,ws-cycle').split(',');
const repeat = Math.max(1, Number(readFlag('--repeat') ?? 1));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const median = (nums) => {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
};

/** Fold N per-run interaction reports into one: median for timing leaves
 *  (the same-machine-comparable fields), max for counters (deterministic —
 *  max is a safety net, not smoothing), everything else from the last run. */
const aggregateReports = (reports) => {
  if (reports.length === 1) return reports[0];
  const last = reports[reports.length - 1];
  const p95Raw = reports.map((r) => r.interactions.p95);
  const over20Raw = reports.map((r) => r.frames.over20msPct);
  const counterNames = new Set(reports.flatMap((r) => Object.keys(r.counters)));
  const counters = {};
  for (const name of counterNames) {
    counters[name] = Math.max(...reports.map((r) => r.counters[name] ?? 0));
  }
  return {
    ...last,
    counters,
    interactions: { ...last.interactions, p95: median(p95Raw) },
    frames: { ...last.frames, over20msPct: median(over20Raw) },
    runs: reports.length,
    raw: { interactionsP95: p95Raw, framesOver20Pct: over20Raw },
  };
};

const evaluate = async (cdp, expression) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`renderer eval failed: ${result.exceptionDetails.text ?? 'unknown'}\n${expression.slice(0, 200)}`);
  }
  return result.result?.value ?? null;
};

/**
 * Occlusion-aware target picking: canvas nodes can overlap (e.g. a webview's
 * error card on top of a note), so a blind center-click may hit the wrong
 * node. Sample points inside each candidate until document.elementFromPoint
 * actually lands within that candidate; returns the first hittable point.
 */
const hittablePointIn = async (cdp, selector) =>
  evaluate(cdp, `(() => {
    const candidates = document.querySelectorAll(${JSON.stringify(selector)});
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width < 8 || r.height < 8) continue;
      const points = [
        [r.x + r.width / 2, r.y + Math.min(40, r.height / 2)],
        [r.x + r.width / 2, r.y + r.height / 2],
        [r.x + 12, r.y + 12],
        [r.x + r.width - 12, r.y + r.height - 12],
      ];
      for (const [x, y] of points) {
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
        const top = document.elementFromPoint(x, y);
        if (top && el.contains(top)) return { x, y };
      }
    }
    return null;
  })()`);

const mouse = (cdp, type, x, y, extra = {}) =>
  cdp.send('Input.dispatchMouseEvent', { type, x: Math.round(x), y: Math.round(y), ...extra });

// Mirrors useCanvasContextMenu's isBlankCanvasTarget selector list — a wheel
// dispatched over a node (e.g. a file node's ProseMirror editor) gets
// consumed by that node's own scroll handling and never reaches the
// canvas-level pan/zoom handler, so panzoomScenario needs a point that is
// genuinely NOT covered by any node/chrome (viewport corners, away from the
// seeded node grid which clusters near center).
const findBlankCanvasPoint = async (cdp) => {
  // A fit-to-view layout (e.g. after seedExtraNodes reloads) can zoom out
  // far enough that a handful of fixed corner guesses all land on some
  // node — dense grids leave only thin, unpredictable gaps. Scan a real
  // grid across the viewport (in-page, one round trip) instead of guessing
  // a few fixed points.
  const point = await evaluate(cdp, `(() => {
    const blockedSel = '.canvas-node, .canvas-empty-hint, .canvas-fullscreen-chip, .canvas-bottom-chrome, '
      + '.floating-toolbar, .zoom-indicator, .context-menu, .canvas-edges, '
      + '.canvas-connect-overlay, .canvas-shape-overlay, .edge-style-panel, .sidebar';
    for (let fy = 0.1; fy <= 0.9; fy += 0.08) {
      for (let fx = 0.1; fx <= 0.9; fx += 0.06) {
        const x = Math.round(innerWidth * fx);
        const y = Math.round(innerHeight * fy);
        const el = document.elementFromPoint(x, y);
        if (!el?.closest(blockedSel)) return { x, y };
      }
    }
    return null;
  })()`);
  if (!point) throw new Error('no blank canvas point found across a full viewport grid scan');
  return point;
};

/** Wait until the renderer main thread stops long-stalling (two calm rAF probes). */
const waitForCalmFrames = async (cdp, timeoutMs = 30_000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const delta = await evaluate(cdp, `new Promise((done) => {
      requestAnimationFrame((a) => requestAnimationFrame((b) => done(b - a)));
    })`).catch(() => 1_000);
    if (delta < 40) return;
    await sleep(250);
  }
};

const clickAt = async (cdp, x, y, clickCount = 1) => {
  await mouse(cdp, 'mousePressed', x, y, { button: 'left', buttons: 1, clickCount });
  await mouse(cdp, 'mouseReleased', x, y, { button: 'left', buttons: 0, clickCount });
};

const beginPerf = (cdp, name) => evaluate(cdp, `window.__pulsePerf.begin(${JSON.stringify(name)})`);
const endPerf = (cdp) => evaluate(cdp, `JSON.stringify(window.__pulsePerf.end())`).then(JSON.parse);

// Force GC twice (V8 needs a second pass to reclaim recently-freed graphs),
// then read the retained JS heap via CDP — Runtime.getHeapUsage is precise,
// unlike the quantized renderer-side performance.memory. Basis for the slope.
const sampleHeapMB = async (cdp) => {
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await sleep(150);
  const usage = await cdp.send('Runtime.getHeapUsage').catch(() => null);
  return usage ? Math.round((usage.usedSize / 1048576) * 10) / 10 : 0;
};

/** Least-squares slope of ys over x = 0..n-1. */
const slope = (ys) => {
  const n = ys.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (ys[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : Math.round((num / den) * 10) / 10;
};

// ── scenarios ────────────────────────────────────────────────────────────────

const startupScenario = async (cdp, session) => {
  const stdout = await fs.readFile(session.logFiles.stdout, 'utf-8').catch(() => '');
  const match = stdout.match(/\[perf\] startup (\{.*\})/);
  const mainPhases = match ? JSON.parse(match[1]) : null;
  await beginPerf(cdp, '_startup_probe');
  const probe = await endPerf(cdp);
  return {
    mainPhases,
    rendererMarks: probe.marks,
    paint: probe.paint,
  };
};

const typingScenario = async (cdp, repeatCount = 1) => {
  const editorSel = '.canvas-node--file .ProseMirror';
  // C1/C6 made FileNodeBody React.lazy — wait for the lazy chunk to load +
  // ProseMirror to mount before targeting it. On CI the chunk lands slower
  // than on dev macOS, so a one-shot query races the lazy boundary.
  await waitFor(
    () => evaluate(cdp, `!!document.querySelector(${JSON.stringify(editorSel)})`),
    10_000,
  );
  const point = await hittablePointIn(cdp, editorSel);
  if (!point) throw new Error(`no unobstructed editor found (${editorSel}) — file nodes missing or fully covered`);
  await waitForCalmFrames(cdp);
  // Click (and if the editor is not focused yet, double-click) to focus.
  await clickAt(cdp, point.x, point.y);
  await sleep(150);
  let focused = await evaluate(cdp, `document.activeElement?.classList?.contains('ProseMirror') ?? false`);
  if (!focused) {
    await clickAt(cdp, point.x, point.y, 2);
    await sleep(150);
    focused = await evaluate(cdp, `document.activeElement?.classList?.contains('ProseMirror') ?? false`);
  }
  if (!focused) throw new Error('editor did not take focus — typing would measure nothing');

  const chars = 'The quick brown fox jumps over the lazy dog while we measure per-keystroke costs on the canvas. '.repeat(2).slice(0, 120);
  const reports = [];
  for (let run = 0; run < repeatCount; run++) {
    await beginPerf(cdp, 'typing');
    for (const ch of chars) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      await sleep(25);
    }
    await sleep(300); // let trailing work land inside the window
    reports.push(await endPerf(cdp));
    if (run < repeatCount - 1) await waitForCalmFrames(cdp);
  }
  return { chars: chars.length, report: aggregateReports(reports) };
};

const dragScenario = async (cdp, repeatCount = 1) => {
  const headerSel = '.canvas-node .node-header';
  const moves = 90;
  const reports = [];
  // Anchor to the first run's point and drag the node back there between
  // repeats (unmeasured) — otherwise each repeat's displacement compounds
  // and eventually walks the node off the (fixed-size headless) viewport.
  let anchor = null;
  for (let run = 0; run < repeatCount; run++) {
    const point = anchor ?? await hittablePointIn(cdp, headerSel);
    if (!point) throw new Error(`no unobstructed node header found (${headerSel})`);
    anchor ??= point;
    await waitForCalmFrames(cdp);
    const startX = point.x;
    const startY = point.y;

    await beginPerf(cdp, 'drag');
    await mouse(cdp, 'mousePressed', startX, startY, { button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= moves; i++) {
      await mouse(cdp, 'mouseMoved', startX + i * 3, startY + i * 2, { buttons: 1 });
      await sleep(16);
    }
    const endX = startX + moves * 3;
    const endY = startY + moves * 2;
    await mouse(cdp, 'mouseReleased', endX, endY, { button: 'left', buttons: 0, clickCount: 1 });
    await sleep(300);
    reports.push(await endPerf(cdp));

    if (run < repeatCount - 1) {
      await mouse(cdp, 'mousePressed', endX, endY, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(cdp, 'mouseMoved', startX, startY, { buttons: 1 });
      await mouse(cdp, 'mouseReleased', startX, startY, { button: 'left', buttons: 0, clickCount: 1 });
      await sleep(200);
    }
  }
  return { moves, report: aggregateReports(reports) };
};

// A4: pan (plain wheel — the app treats unmodified wheel deltas as a direct
// transform translate, see useCanvas.ts handleWheel) and zoom (ctrl+wheel —
// modifiers bit 2 = Ctrl in the CDP Input domain) over a genuinely blank
// canvas point (found via findBlankCanvasPoint — a wheel dispatched over a
// node gets consumed by that node's own scroll/webview handling and never
// reaches the canvas-level handler). Guards the interact aspect's panzoom
// north star; no counter guard (pan/zoom never touch the nodes array).
// interactions.p95 (INP) structurally reads 0 here — wheel/scroll isn't in
// the Event Timing API's discrete-interaction set — so frames.over20msPct
// is the metric that actually carries signal for this scenario.
const panzoomScenario = async (cdp, repeatCount = 1) => {
  const point = await findBlankCanvasPoint(cdp);
  const reports = [];
  for (let run = 0; run < repeatCount; run++) {
    await waitForCalmFrames(cdp);
    await beginPerf(cdp, 'panzoom');
    for (let i = 0; i < 30; i++) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: point.x, y: point.y, deltaX: 6, deltaY: 4,
      });
      await sleep(16);
    }
    // Alternate zoom-in/zoom-out so repeated runs don't drift the scale
    // into its clamp (which would make later repeats measure less work).
    for (let i = 0; i < 20; i++) {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel', x: point.x, y: point.y,
        deltaX: 0, deltaY: i % 2 === 0 ? -20 : 20, modifiers: 2,
      });
      await sleep(16);
    }
    await sleep(300);
    reports.push(await endPerf(cdp));
  }
  return { report: aggregateReports(reports) };
};

// Memory-retention scenario (H1 guard): seed K workspaces, visit them one by
// one, and after each visit force GC and sample the retained JS heap. The
// slope (MB per additional distinct workspace kept mounted) is the north-star
// for the memory aspect — with H1 present it is clearly positive; once B8's
// LRU eviction lands it flattens toward ~0.
const wsCycleScenario = async (cdp) => {
  const K = 5;
  const nodesPer = 30;
  // Seed K canvases + register them in the manifest, then reload so the
  // sidebar renders them.
  await evaluate(cdp, `(async () => {
    const store = window.canvasWorkspace.store;
    const now = Date.now();
    const mk = (wsId) => {
      const nodes = [];
      for (let i = 0; i < ${nodesPer}; i++) {
        nodes.push({
          id: wsId + '-n' + i, type: 'text', title: 'n' + i,
          x: (i % 6) * 240, y: Math.floor(i / 6) * 160, width: 200, height: 120,
          updatedAt: now, data: { text: 'retain probe ' + wsId + ' ' + i },
        });
      }
      return { nodes, edges: [], savedAt: new Date().toISOString() };
    };
    const manifest = await store.load('__workspaces__');
    const data = manifest.data ?? { workspaces: [], folders: [] };
    for (let k = 1; k <= ${K}; k++) {
      const wsId = 'ws-perf-' + k;
      await store.save(wsId, mk(wsId));
      if (!data.workspaces.some((w) => w.id === wsId)) {
        data.workspaces.push({ id: wsId, name: 'perf ' + k });
      }
    }
    await store.save('__workspaces__', data);
  })()`);
  await evaluate(cdp, 'location.reload()').catch(() => {});
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const entries = await evaluate(cdp, `window.__pulsePerf && document.querySelectorAll('.sidebar-workspace-entry').length`).catch(() => 0);
    if (entries >= K + 1) break;
  }
  await waitForCalmFrames(cdp);

  const heaps = [await sampleHeapMB(cdp)]; // baseline: only the default workspace mounted
  const entryCount = await evaluate(cdp, `document.querySelectorAll('.sidebar-workspace-entry').length`);
  for (let n = 1; n < entryCount; n++) {
    const point = await evaluate(cdp, `(() => {
      const el = document.querySelectorAll('.sidebar-workspace-entry')[${n}];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!point) break;
    await clickAt(cdp, point.x, point.y);
    await waitForCalmFrames(cdp);
    await sleep(400);
    heaps.push(await sampleHeapMB(cdp));
  }
  return {
    workspaces: entryCount - 1,
    heapsMB: heaps,
    heapSlopeMB: slope(heaps),
    peakHeapMB: Math.max(...heaps),
  };
};

// Seed extra text nodes into the active workspace and reload so the canvas
// renders them — turns the welcome canvas into an N-node benchmark surface.
const seedExtraNodes = async (cdp, count) => {
  const nodeCount = await evaluate(cdp, `document.querySelectorAll('.canvas-node').length`);
  if (nodeCount >= count) return nodeCount;
  await evaluate(cdp, `(async () => {
    const store = window.canvasWorkspace.store;
    const list = await store.list();
    const wsId = list.ids[0];
    const loaded = await store.load(wsId);
    const data = loaded.data ?? {};
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const existing = new Set(nodes.map((n) => n.id));
    const now = Date.now();
    for (let i = 0; nodes.length < ${count}; i++) {
      const id = 'perf-seed-' + i;
      if (existing.has(id)) continue;
      nodes.push({
        id, type: 'text', title: 'perf ' + i,
        x: 1400 + (i % 10) * 240, y: -600 + Math.floor(i / 10) * 160,
        width: 200, height: 120, updatedAt: now,
        data: { text: 'perf seed node ' + i },
      });
    }
    await store.save(wsId, { ...data, nodes });
  })()`);
  await evaluate(cdp, 'location.reload()').catch(() => {});
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const ready = await evaluate(
      cdp,
      `window.__pulsePerf && document.querySelectorAll('.canvas-node').length`,
    ).catch(() => 0);
    if (ready >= count) {
      // A fresh 100-node mount stalls the main thread for a while (text-node
      // layout effects + editors) — wait it out before dispatching input.
      await waitForCalmFrames(cdp);
      return ready;
    }
  }
  throw new Error('seeded nodes did not appear after reload');
};

// ── gates ────────────────────────────────────────────────────────────────────

const compareCounterGates = (baselines, scenarios) => {
  const runtime = baselines.runtime ?? {};
  const results = [];
  for (const [scenario, gatesForScenario] of Object.entries(runtime)) {
    const report = scenarios[scenario]?.report;
    if (!report) continue;
    for (const [counter, { max }] of Object.entries(gatesForScenario.counters ?? {})) {
      const value = report.counters?.[counter] ?? 0;
      results.push({ scenario, counter, max, value, pass: value <= max });
    }
  }
  return results;
};

// ── main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  const session = await requireLiveSession();
  const baselines = JSON.parse(await fs.readFile(baselinesPath, 'utf-8'));
  const scenarios = {};

  await withPage(session, async (cdp) => {
    await cdp.send('Page.bringToFront');
    if (seedNodes > 0) {
      const total = await seedExtraNodes(cdp, seedNodes);
      console.log(`[perf:scenarios] canvas seeded: ${total} nodes`);
    }
    if (only.includes('startup')) scenarios.startup = await startupScenario(cdp, session);
    if (only.includes('typing')) scenarios.typing = await typingScenario(cdp, repeat);
    if (only.includes('drag')) scenarios.drag = await dragScenario(cdp, repeat);
    if (only.includes('panzoom')) scenarios.panzoom = await panzoomScenario(cdp, repeat);
    // ws-cycle runs last — it seeds extra workspaces and reloads, so it must
    // not disturb the single-workspace typing/drag/panzoom scenarios above.
    if (only.includes('ws-cycle')) scenarios['ws-cycle'] = await wsCycleScenario(cdp);
  });

  // Aggregate main-process event-loop delay + canvas-save file-write counts
  // from the sampler's log lines (active only when PULSE_CANVAS_PERF=1).
  const stdout = await fs.readFile(session.logFiles.stdout, 'utf-8').catch(() => '');
  const loopDelays = [...stdout.matchAll(/\[perf\] loop-delay (\{.*\})/g)].map((m) => JSON.parse(m[1]));
  const canvasSaves = [...stdout.matchAll(/\[perf\] canvas-save (\{.*\})/g)].map((m) => JSON.parse(m[1]));
  const sessionPersists = [...stdout.matchAll(/\[perf\] session-persist (\{.*\})/g)].map((m) => JSON.parse(m[1]));
  if (loopDelays.length || canvasSaves.length || sessionPersists.length) {
    const main = { windows: loopDelays.length };
    if (loopDelays.length) {
      main.loopDelayP99Ms = Math.max(...loopDelays.map((d) => d.p99));
      main.loopDelayMaxMs = Math.max(...loopDelays.map((d) => d.max));
      main.peakRssKb = Math.max(...loopDelays.map((d) => d.rssKb ?? 0));
    }
    if (canvasSaves.length) {
      // Max files-written across saves in this run (B3 gate: most saves skip
      // byte-identical per-node writes, so this should stay low).
      main.canvasSaveFilesWritten = Math.max(...canvasSaves.map((s) => s.filesWritten ?? 0));
    }
    if (sessionPersists.length) {
      // Max bytes per persist call (J-1 gate: each call today rewrites the
      // full session; an incremental fix drops this toward O(delta)).
      main.sessionPersistBytes = Math.max(...sessionPersists.map((s) => s.bytes ?? 0));
    }
    scenarios.main = main;
  }

  const gateResults = compareCounterGates(baselines, scenarios);
  const report = {
    generatedAt: new Date().toISOString(),
    session: { id: session.id, profile: session.profile },
    seedNodes: seedNodes || undefined,
    scenarios,
    gates: gateResults,
  };
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(join(outDir, 'scenarios-report.json'), JSON.stringify(report, null, 2));

  if (scenarios.startup?.mainPhases) {
    console.log('[perf:scenarios] startup phases (ms):', JSON.stringify(scenarios.startup.mainPhases));
  }
  for (const name of ['typing', 'drag', 'panzoom']) {
    const entry = scenarios[name];
    if (!entry) continue;
    const r = entry.report;
    const runsSuffix = r.runs > 1 ? ` (median of ${r.runs} runs, raw=${JSON.stringify(r.raw)})` : '';
    console.log(
      `[perf:scenarios] ${name}: counters=${JSON.stringify(r.counters)} `
      + `INPp95=${r.interactions.p95}ms frames>20ms=${r.frames.over20msPct}% `
      + `LoAF=${r.longAnimationFrames.count}/${r.longAnimationFrames.blockingMs}ms${runsSuffix}`,
    );
  }
  const wsc = scenarios['ws-cycle'];
  if (wsc) {
    console.log(
      `[perf:scenarios] ws-cycle: ${wsc.workspaces} workspaces, heap ${JSON.stringify(wsc.heapsMB)} MB, `
      + `slope=${wsc.heapSlopeMB} MB/ws, peak=${wsc.peakHeapMB} MB`,
    );
  }
  if (scenarios.main) {
    console.log(
      `[perf:scenarios] main: loop-delay p99=${scenarios.main.loopDelayP99Ms}ms `
      + `max=${scenarios.main.loopDelayMaxMs}ms over ${scenarios.main.windows} windows`,
    );
  }
  for (const gate of gateResults) {
    console.log(
      `[perf:scenarios] ${gate.pass ? 'PASS' : 'FAIL'} ${gate.scenario}.${gate.counter}: `
      + `${gate.value} (max ${gate.max})`,
    );
  }
  console.log('[perf:scenarios] report: perf/out/scenarios-report.json');
  if (gateResults.some((gate) => !gate.pass)) process.exit(1);
  if (gateResults.length === 0) {
    console.log('[perf:scenarios] record mode: no "runtime" gates in perf/baselines.json yet — use this run to set them.');
  }
};

main().catch((err) => {
  console.error('[perf:scenarios]', err.message ?? err);
  process.exit(2);
});
