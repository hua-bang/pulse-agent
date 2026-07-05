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
const only = (readFlag('--scenario') ?? 'startup,typing,drag,ws-cycle').split(',');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const typingScenario = async (cdp) => {
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
  await beginPerf(cdp, 'typing');
  for (const ch of chars) {
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
    await sleep(25);
  }
  await sleep(300); // let trailing work land inside the window
  const report = await endPerf(cdp);
  return { chars: chars.length, report };
};

const dragScenario = async (cdp) => {
  const headerSel = '.canvas-node .node-header';
  const point = await hittablePointIn(cdp, headerSel);
  if (!point) throw new Error(`no unobstructed node header found (${headerSel})`);
  await waitForCalmFrames(cdp);
  const startX = point.x;
  const startY = point.y;
  const moves = 90;

  await beginPerf(cdp, 'drag');
  await mouse(cdp, 'mousePressed', startX, startY, { button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= moves; i++) {
    await mouse(cdp, 'mouseMoved', startX + i * 3, startY + i * 2, { buttons: 1 });
    await sleep(16);
  }
  await mouse(cdp, 'mouseReleased', startX + moves * 3, startY + moves * 2, { button: 'left', buttons: 0, clickCount: 1 });
  await sleep(300);
  const report = await endPerf(cdp);
  return { moves, report };
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
    if (only.includes('typing')) scenarios.typing = await typingScenario(cdp);
    if (only.includes('drag')) scenarios.drag = await dragScenario(cdp);
    // ws-cycle runs last — it seeds extra workspaces and reloads, so it must
    // not disturb the single-workspace typing/drag scenarios above.
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
  for (const name of ['typing', 'drag']) {
    const entry = scenarios[name];
    if (!entry) continue;
    const r = entry.report;
    console.log(
      `[perf:scenarios] ${name}: counters=${JSON.stringify(r.counters)} `
      + `INPp95=${r.interactions.p95}ms frames>20ms=${r.frames.over20msPct}% `
      + `LoAF=${r.longAnimationFrames.count}/${r.longAnimationFrames.blockingMs}ms`,
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
