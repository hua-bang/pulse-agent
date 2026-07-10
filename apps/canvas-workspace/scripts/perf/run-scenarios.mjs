#!/usr/bin/env node
/**
 * Phase-B runtime scenario benchmarks, driven through the app harness.
 *
 * Prereq: a live harness session (the app already running):
 *   pnpm --filter canvas-workspace build
 *   node harness/tools/driver/cli.mjs start --profile temp   # DISPLAY required (xvfb ok)
 *   pnpm --filter canvas-workspace perf:scenarios [--seed-nodes 100] [--seed-webpages 30]
 *
 * `--seed-webpages N` (opt-in, default 0): N of the `--seed-nodes` total are
 * seeded as `iframe` (mode: 'html') nodes — real sandboxed `<iframe srcDoc>`
 * elements, same DOM/paint weight class as a user's actual "Web page" node —
 * instead of plain `text` nodes. Deterministic, self-contained inline HTML
 * (no network fetch), so it stays CI-safe. Default stays 0 so existing
 * baselines/history are unaffected; use this for one-off comparisons that
 * need a heavier, more representative node-type mix (the tile-memory /
 * pan-zoom regression scales with painted surface area, which text nodes
 * barely exercise).
 *
 * Scenarios (all metrics come from window.__pulsePerf + startup log line):
 *   startup  – main-process phase marks + renderer first-frame/canvas marks + FCP
 *   typing   – types into the first file node; guards I-1 via the
 *              nodes-array-replace counter (today: ≈1 replacement per keystroke)
 *   resize   – resizes the first node from its bottom-right corner; records
 *              the same per-pointer-move interaction and frame metrics
 *   drag     – drags the first node by its header; guards A2 via the same
 *              counter (today: ≈1 replacement per pointer-move)
 *
 * Counter gates compare against perf/baselines.json → "runtime". Timing
 * metrics (INP p95, frame stats) are recorded as informational until enough
 * runs exist to set tolerances. Exit 1 on counter-gate failure.
 *
 * `--repeat N` (A3): typing/resize/drag are re-driven N times against the same live
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
import { requireLiveSession } from '../../harness/tools/driver/src/session.mjs';
import { withPage } from '../../harness/tools/driver/src/cdp.mjs';
import { waitFor } from '../../harness/tools/driver/src/utils.mjs';
import { compareCounterGates } from './runtime-gates.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baselinesPath = join(appRoot, 'perf/baselines.json');
const metricsPath = join(appRoot, 'perf/metrics.json');
const outDir = join(appRoot, 'perf/out');

const args = process.argv.slice(2);
const readFlag = (name) => {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : undefined;
};
const seedNodes = Number(readFlag('--seed-nodes') ?? 0);
const seedWebpages = Number(readFlag('--seed-webpages') ?? 0);
const only = (readFlag('--scenario') ?? 'startup,chat-stream,image-memory,typing,resize,drag,panzoom,ws-cycle').split(',');
const repeat = Math.max(1, Number(readFlag('--repeat') ?? 1));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Covers the editor's 200ms writeback debounce plus useNodes' 800ms save
// debounce, with margin for a busy renderer. Counter windows must start with
// no prior save pending and end only after the measured gesture's save fires.
const SAVE_DRAIN_MS = 1_200;
const drainCanvasSave = () => sleep(SAVE_DRAIN_MS);

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
  const counterRaw = reports.map((report) => Object.fromEntries(
    [...counterNames].map((name) => [name, report.counters[name] ?? 0]),
  ));
  return {
    ...last,
    counters,
    interactions: { ...last.interactions, p95: median(p95Raw) },
    frames: { ...last.frames, over20msPct: median(over20Raw) },
    runs: reports.length,
    raw: { interactionsP95: p95Raw, framesOver20Pct: over20Raw, counters: counterRaw },
  };
};

const requireCounterInEveryRun = (scenario, reports, counter) => {
  const emptyRuns = reports
    .map((report, index) => ({ index, value: report.counters[counter] ?? 0 }))
    .filter(({ value }) => value <= 0);
  if (emptyRuns.length > 0) {
    const runs = emptyRuns.map(({ index }) => index + 1).join(', ');
    throw new Error(`${scenario} did not produce ${counter} in run(s): ${runs}`);
  }
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

const chatStreamScenario = async (cdp) => {
  const inputSel = '.chat-panel .chat-input[contenteditable="true"]';
  const sendSel = '.chat-panel .chat-send-btn:not(.chat-send-btn--stop)';
  await evaluate(cdp, `document.querySelector('.ui-drawer-close')?.click()`);
  await waitFor(() => evaluate(cdp, `!!document.querySelector(${JSON.stringify(inputSel)})`), 10_000);
  const initialAssistantCount = await evaluate(
    cdp,
    `document.querySelectorAll('.chat-panel .chat-message-assistant').length`,
  );
  await evaluate(cdp, `(() => {
    const input = document.querySelector(${JSON.stringify(inputSel)});
    if (!(input instanceof HTMLElement)) throw new Error('chat perf input missing');
    input.textContent = '__pulse_perf_chat_stream__';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  })()`);
  await waitFor(
    () => evaluate(cdp, `!document.querySelector(${JSON.stringify(sendSel)})?.hasAttribute('disabled')`),
    5_000,
  );
  await waitForCalmFrames(cdp);
  await beginPerf(cdp, 'chat-stream');
  await evaluate(cdp, `document.querySelector(${JSON.stringify(sendSel)})?.click()`);
  await waitFor(
    () => evaluate(cdp, `!!document.querySelector('.chat-panel .chat-send-btn--stop')`),
    5_000,
  );
  await waitFor(
    () => evaluate(cdp, `!document.querySelector('.chat-panel .chat-send-btn--stop')`),
    30_000,
  );
  const streamEndedAt = await evaluate(cdp, 'performance.now()');
  await waitFor(
    () => evaluate(cdp, `(() => {
      const messages = document.querySelectorAll('.chat-panel .chat-message-assistant');
      if (messages.length <= ${initialAssistantCount}) return false;
      const latest = messages[messages.length - 1];
      const mermaid = latest.querySelector('.chat-mermaid');
      return mermaid?.getAttribute('data-rendered') === 'true';
    })()`),
    30_000,
  );
  const tailBurstMs = await evaluate(
    cdp,
    `Math.round((performance.now() - ${streamEndedAt}) * 10) / 10`,
  );
  const report = await endPerf(cdp);
  if ((report.counters['chat-md-stream-render'] ?? 0) <= 0) {
    throw new Error('chat-stream replay produced no streaming markdown renders');
  }
  return {
    report,
    tailBurstMs,
    markdownRenders: report.counters['chat-md-stream-render'],
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
  await drainCanvasSave();
  for (let run = 0; run < repeatCount; run++) {
    await beginPerf(cdp, 'typing');
    for (const ch of chars) {
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch });
      await sleep(25);
    }
    await drainCanvasSave();
    reports.push(await endPerf(cdp));
    if (run < repeatCount - 1) await waitForCalmFrames(cdp);
  }
  requireCounterInEveryRun('typing', reports, 'nodes-array-replace');
  requireCounterInEveryRun('typing', reports, 'canvas-save-ipc');
  return { chars: chars.length, report: aggregateReports(reports) };
};

const resizeScenario = async (cdp, repeatCount = 1) => {
  const handleSel = '.canvas-node .resize-handle--corner';
  const moves = 90;
  const reports = [];
  // Re-query the live handle each run: resize/re-render can shift it by a
  // rounding pixel, and a stale coordinate silently turns later repeats into
  // no-ops. Reset outside the measured window so every run covers one delta.
  await drainCanvasSave();
  for (let run = 0; run < repeatCount; run++) {
    const point = await hittablePointIn(cdp, handleSel);
    if (!point) throw new Error(`no unobstructed node resize handle found (${handleSel})`);
    await waitForCalmFrames(cdp);
    const startX = point.x;
    const startY = point.y;
    const stepX = startX > moves + 24 ? -1 : 1;
    const stepY = startY > moves / 2 + 24 ? -0.5 : 0.5;

    await beginPerf(cdp, 'resize');
    await mouse(cdp, 'mousePressed', startX, startY, { button: 'left', buttons: 1, clickCount: 1 });
    for (let i = 1; i <= moves; i++) {
      await mouse(cdp, 'mouseMoved', startX + i * stepX, startY + Math.round(i * stepY), { buttons: 1 });
      await sleep(16);
    }
    const endX = startX + moves * stepX;
    const endY = startY + Math.round(moves * stepY);
    await mouse(cdp, 'mouseReleased', endX, endY, { button: 'left', buttons: 0, clickCount: 1 });
    await drainCanvasSave();
    reports.push(await endPerf(cdp));

    if (run < repeatCount - 1) {
      const resetPoint = await hittablePointIn(cdp, handleSel);
      if (!resetPoint) throw new Error(`resize handle unavailable for reset (${handleSel})`);
      await mouse(cdp, 'mousePressed', resetPoint.x, resetPoint.y, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(cdp, 'mouseMoved', startX, startY, { buttons: 1 });
      await mouse(cdp, 'mouseReleased', startX, startY, { button: 'left', buttons: 0, clickCount: 1 });
      await drainCanvasSave();
    }
  }
  requireCounterInEveryRun('resize', reports, 'nodes-array-replace');
  requireCounterInEveryRun('resize', reports, 'canvas-save-ipc');
  return { moves, report: aggregateReports(reports) };
};

const dragScenario = async (cdp, repeatCount = 1) => {
  const headerSel = '.canvas-node .node-header';
  const moves = 90;
  const reports = [];
  // Re-query the live header each run and after every measured drag. A fixed
  // coordinate can miss after a re-render and silently turn repeats into
  // no-ops. The reset stays outside the measured window.
  await drainCanvasSave();
  for (let run = 0; run < repeatCount; run++) {
    const point = await hittablePointIn(cdp, headerSel);
    if (!point) throw new Error(`no unobstructed node header found (${headerSel})`);
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
    await drainCanvasSave();
    reports.push(await endPerf(cdp));

    if (run < repeatCount - 1) {
      const resetPoint = await hittablePointIn(cdp, headerSel);
      if (!resetPoint) throw new Error(`node header unavailable for reset (${headerSel})`);
      await mouse(cdp, 'mousePressed', resetPoint.x, resetPoint.y, { button: 'left', buttons: 1, clickCount: 1 });
      await mouse(cdp, 'mouseMoved', startX, startY, { buttons: 1 });
      await mouse(cdp, 'mouseReleased', startX, startY, { button: 'left', buttons: 0, clickCount: 1 });
      await drainCanvasSave();
    }
  }
  requireCounterInEveryRun('drag', reports, 'nodes-array-replace');
  requireCounterInEveryRun('drag', reports, 'canvas-save-ipc');
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

// Fully self-contained HTML — no network fetch, no external assets — used
// as the seeded "web page" nodes' content. Real `<iframe srcDoc>` paint/
// layout weight without the flakiness (or repeated hits to a real site) of
// pointing seeded nodes at a live URL from CI.
const PERF_WEBPAGE_HTML = [
  '<!doctype html><html><body style="margin:0;font:14px system-ui;',
  'padding:16px;background:#0b1220;color:#e2e8f0">',
  '<h3>Perf seed page</h3>',
  '<p>Deterministic inline content for the pan/zoom tile-memory scenario.</p>',
  '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px">',
  Array.from({ length: 12 }, (_, i) => `<div style="height:40px;border-radius:6px;background:hsl(${i * 30},70%,45%)"></div>`).join(''),
  '</div></body></html>',
].join('');

// Seed extra nodes into the active workspace and reload so the canvas
// renders them — turns the welcome canvas into an N-node benchmark surface.
// `webpageCount` of the `count` total are seeded as `iframe` (mode: 'html')
// nodes instead of `text` (see PERF_WEBPAGE_HTML above); the grid stride
// widens to fit the larger default iframe size (520x400 vs 200x120) so
// nothing overlaps regardless of mix.
const seedExtraNodes = async (cdp, count, webpageCount = 0) => {
  const nodeCount = await evaluate(cdp, `document.querySelectorAll('.canvas-node').length`);
  if (nodeCount >= count) {
    const webpages = await evaluate(cdp, `document.querySelectorAll('.canvas-node--iframe').length`).catch(() => 0);
    return { total: nodeCount, webpages };
  }
  const webpageStride = webpageCount > 0 ? Math.max(1, Math.floor(count / webpageCount)) : 0;
  const strideX = webpageCount > 0 ? 560 : 240;
  const strideY = webpageCount > 0 ? 420 : 160;
  await evaluate(cdp, `(async () => {
    const store = window.canvasWorkspace.store;
    const list = await store.list();
    const wsId = list.ids[0];
    const loaded = await store.load(wsId);
    const data = loaded.data ?? {};
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const existing = new Set(nodes.map((n) => n.id));
    const now = Date.now();
    const webpageHtml = ${JSON.stringify(PERF_WEBPAGE_HTML)};
    for (let i = 0; nodes.length < ${count}; i++) {
      const id = 'perf-seed-' + i;
      if (existing.has(id)) continue;
      const x = 1400 + (i % 10) * ${strideX}, y = -600 + Math.floor(i / 10) * ${strideY};
      if (${webpageStride} > 0 && i % ${webpageStride} === 0) {
        nodes.push({
          id, type: 'iframe', title: 'perf web ' + i,
          x, y, width: 520, height: 400, updatedAt: now,
          data: { url: '', mode: 'html', html: webpageHtml, prompt: '' },
        });
      } else {
        nodes.push({
          id, type: 'text', title: 'perf ' + i,
          x, y, width: 200, height: 120, updatedAt: now,
          data: { text: 'perf seed node ' + i },
        });
      }
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
      // layout effects + editors, iframe subdocuments) — wait it out before
      // dispatching input.
      await waitForCalmFrames(cdp);
      const webpages = await evaluate(
        cdp,
        `document.querySelectorAll('.canvas-node--iframe').length`,
      ).catch(() => 0);
      return { total: ready, webpages };
    }
  }
  throw new Error('seeded nodes did not appear after reload');
};

const imageMemoryScenario = async (cdp) => {
  const imageCount = 10;
  const originalWidth = 4000;
  const originalHeight = 3000;
  await evaluate(cdp, `(async () => {
    const store = window.canvasWorkspace.store;
    const list = await store.list();
    const wsId = list.ids[0];
    const canvas = document.createElement('canvas');
    canvas.width = ${originalWidth};
    canvas.height = ${originalHeight};
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#325d88';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f4f7fb';
    ctx.font = '160px system-ui';
    ctx.fillText('Pulse Canvas perf image', 240, 420);
    const base64 = canvas.toDataURL('image/png').split(',')[1];
    const filePaths = [];
    for (let i = 0; i < ${imageCount}; i++) {
      const saved = await window.canvasWorkspace.file.saveImage(wsId, base64, 'png');
      if (!saved.ok || !saved.filePath) throw new Error(saved.error || 'failed to save perf image');
      filePaths.push(saved.filePath);
    }
    const loaded = await store.load(wsId);
    const data = loaded.data ?? {};
    const nodes = (data.nodes ?? []).filter((node) => !node.id.startsWith('perf-image-'));
    const now = Date.now();
    for (let index = 0; index < filePaths.length; index++) {
      nodes.push({
        id: 'perf-image-' + index,
        type: 'image',
        title: 'perf 4K image ' + index,
        x: 80 + (index % 5) * 220,
        y: 540 + Math.floor(index / 5) * 180,
        width: 200,
        height: 150,
        updatedAt: now,
        data: { filePath: filePaths[index] },
      });
    }
    await store.save(wsId, { ...data, nodes, transform: { x: 250, y: 20, scale: 0.5 } });
  })()`);
  await evaluate(cdp, 'location.reload()').catch(() => {});

  let images = [];
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    images = await evaluate(cdp, `([...document.querySelectorAll('.canvas-node--image img')]
      .filter((img) => img.complete && img.naturalWidth > 0)
      .map((img) => ({ width: img.naturalWidth, height: img.naturalHeight, src: img.currentSrc || img.src })))`)
      .catch(() => []);
    if (images.length >= imageCount && images.every((image) => image.width <= 960)) break;
  }
  if (images.length < imageCount || images.some((image) => image.width > 960)) {
    const maxWidth = images.length > 0 ? Math.max(...images.map((image) => image.width)) : 0;
    throw new Error(`image-memory preview readiness failed: ${images.length}/${imageCount}, max width ${maxWidth}`);
  }
  const decodedBytes = images.reduce((sum, image) => sum + image.width * image.height * 4, 0);
  const originalDecodedBytes = imageCount * originalWidth * originalHeight * 4;
  return {
    images: imageCount,
    decodedMB: Math.round(decodedBytes / 1024 / 1024 * 10) / 10,
    originalDecodedMB: Math.round(originalDecodedBytes / 1024 / 1024 * 10) / 10,
    maxDecodedWidth: Math.max(...images.map((image) => image.width)),
    reductionRatio: Math.round(originalDecodedBytes / decodedBytes * 10) / 10,
  };
};

// ── main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  const session = await requireLiveSession();
  const baselines = JSON.parse(await fs.readFile(baselinesPath, 'utf-8'));
  const dictionary = JSON.parse(await fs.readFile(metricsPath, 'utf-8'));
  const scenarios = {};

  await withPage(session, async (cdp) => {
    await cdp.send('Page.bringToFront');
    if (seedNodes > 0) {
      const { total, webpages } = await seedExtraNodes(cdp, seedNodes, seedWebpages);
      console.log(
        `[perf:scenarios] canvas seeded: ${total} nodes`
        + (webpages > 0 ? ` (${webpages} webpage)` : ''),
      );
    }
    if (only.includes('startup')) scenarios.startup = await startupScenario(cdp, session);
    if (only.includes('chat-stream')) scenarios['chat-stream'] = await chatStreamScenario(cdp);
    if (only.includes('image-memory')) scenarios['image-memory'] = await imageMemoryScenario(cdp);
    if (only.includes('typing')) scenarios.typing = await typingScenario(cdp, repeat);
    if (only.includes('resize')) scenarios.resize = await resizeScenario(cdp, repeat);
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

  const gateResults = compareCounterGates(baselines, scenarios, only, dictionary);
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
  for (const name of ['typing', 'resize', 'drag', 'panzoom']) {
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
  const imageMemory = scenarios['image-memory'];
  if (imageMemory) {
    console.log(
      `[perf:scenarios] image-memory: ${imageMemory.images} images, `
      + `${imageMemory.decodedMB} MB decoded vs ${imageMemory.originalDecodedMB} MB original `
      + `(${imageMemory.reductionRatio}× reduction, max width ${imageMemory.maxDecodedWidth})`,
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
