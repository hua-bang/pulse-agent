#!/usr/bin/env node
/**
 * Deep zoom-gesture probe — DIAGNOSTIC, never gated. Answers the one
 * mid-gesture question the Chromium renderer bench cannot: what a deep
 * ctrl+wheel zoom-out/in costs on REAL Electron, with the two embed kinds
 * the rig can't tell apart — same-process inline iframes (html/srcdoc) vs
 * cross-process <webview> guests (url mode, OOPIF surfaces that scale on
 * the compositor instead of re-rastering in the embedder).
 *
 * P0 regression baseline (2026-07-14): this now locks the zoom-out
 * baseline the follow-up work (inline-iframe two-phase static-ization,
 * webview gesture-rate lease) must beat. It measures FIVE windows and a
 * `tile memory limits exceeded` counter (the exact Chromium warning the
 * removed `will-change` used to trigger), reported as the MEDIAN over N
 * repeats so a single noisy CI run can't set the bar:
 *   zoomOut 1→0.35 · zoomOut 0.35→0.1 · overview settle ·
 *   zoomIn 0.1→1 · zoom-in settle
 * Each window: frames>20ms% · frame p95 · frame max · long-task ms.
 * Plus live inline/webview counts and total tile-memory warnings.
 *
 *   ZOOM_PROBE_PROFILE=grid|large   (default grid: 5×5, 24 inline+url embeds)
 *   ZOOM_PROBE_REPEAT=N             (default 3, median over N cycles)
 *
 *   node harness/tools/driver/cli.mjs start --profile temp --headless
 *   node scripts/perf/zoom-gesture-probe.mjs
 *   node harness/tools/driver/cli.mjs close --cleanup
 *
 * Prints INFO numbers + a PASS/FAIL-style comparison against the proposed
 * acceptance lines (informational — the step never gates), exits 0 unless
 * the probe itself malfunctions (gesture didn't move the transform, embeds
 * never mounted).
 */
import { createServer } from 'node:http';
import { requireLiveSession } from '../../harness/tools/driver/src/session.mjs';
import { withPage } from '../../harness/tools/driver/src/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROBE_WS_ID = 'zoom-probe-ws';
const PROFILE = process.env.ZOOM_PROBE_PROFILE === 'large' ? 'large' : 'grid';
const REPEAT = Math.max(1, Number(process.env.ZOOM_PROBE_REPEAT ?? 3));
const NODE_W = 520;
const NODE_H = 400;
const STRIDE_X = 560;
const STRIDE_Y = 440;

// Proposed acceptance lines (from the follow-up plan) — informational only.
const ACCEPTANCE = {
  'zoomOut frames>20ms median': { get: (m) => m.zoomOutOver20, max: 10, unit: '%' },
  'zoomOut frame p95 median': { get: (m) => m.zoomOutP95, max: 33, unit: 'ms' },
  'zoomOut worst frame median': { get: (m) => m.zoomOutMax, max: 100, unit: 'ms' },
  'overview settle median': { get: (m) => m.settleOver20, max: 3, unit: '%' },
  'zoom-in median': { get: (m) => m.zoomInOver20, max: 8, unit: '%' },
  'tile-memory warnings (worst run)': { get: (m) => m.tileMemWorst, max: 0, unit: '' },
};

// Animated so mid-gesture raster is non-trivial (a static page would
// undersell the cost the rig measured on animated fixtures).
const ANIMATED_HTML = `<!doctype html><html><head><style>
  body { margin: 0; font: 14px sans-serif; }
  .spin { width: 60px; height: 60px; margin: 20px; background: #4a90d9;
    border-radius: 8px; animation: r 1.6s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
</style></head><body>
  <div class="spin"></div><div id="t"></div>
  <script>
    const t = document.getElementById('t'); let n = 0;
    setInterval(() => { t.textContent = 'tick ' + (++n); }, 250);
  </script>
</body></html>`;

const probeServer = createServer((_req, res) => {
  res.setHeader('content-type', 'text/html');
  res.end(ANIMATED_HTML);
});

const evaluate = async (cdp, expression) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`renderer eval failed: ${result.exceptionDetails.text ?? 'unknown'}`);
  }
  return result.result?.value ?? null;
};

const info = (name, detail) => console.log(`INFO  ${name} — ${detail}`);
const fail = (msg) => {
  console.error(`PROBE MALFUNCTION: ${msg}`);
  process.exit(1);
};
const median = (xs) => {
  const s = [...xs].filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (!s.length) return 0;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
};

/**
 * Read the VISIBLE canvas's scale: background workspaces stay mounted
 * (LRU capacity 4), each with its own .canvas-transform — a bare
 * querySelector can land on the hidden welcome canvas whose scale never
 * moves (run #122).
 */
const readScale = (cdp) => evaluate(cdp, `(() => {
  const els = [...document.querySelectorAll('.canvas-transform')];
  const el = els.find((e) => e.offsetParent !== null) ?? els[0];
  return Math.round(new DOMMatrixReadOnly(getComputedStyle(el).transform).a * 1000) / 1000;
})()`);

const embedCounts = (cdp) => evaluate(cdp, `({
  inline: document.querySelectorAll('.canvas-node--iframe iframe:not(.iframe-frame--pending)').length,
  webviews: document.querySelectorAll('.canvas-node--iframe webview').length,
})`);

const dumpDiag = async (cdp, point) => {
  const diag = await evaluate(cdp, `(() => {
    const els = [...document.querySelectorAll('.canvas-transform')];
    const at = document.elementFromPoint(${point.x}, ${point.y});
    return {
      transforms: els.map((e) => ({
        scale: Math.round(new DOMMatrixReadOnly(getComputedStyle(e).transform).a * 1000) / 1000,
        visible: e.offsetParent !== null,
      })),
      wheelTarget: at ? { tag: at.tagName, cls: String(at.className).slice(0, 140) } : null,
      inner: [innerWidth, innerHeight],
    };
  })()`).catch((err) => ({ diagError: String(err) }));
  console.log('DIAG', JSON.stringify(diag));
};

/** Wheel at a blank canvas point near the viewport center (embeds eat
 * wheel events — the layout leaves a blank cell there for this). */
const blankPoint = (cdp) => evaluate(cdp, `(() => {
  const cx = Math.round(innerWidth / 2), cy = Math.round(innerHeight / 2);
  for (let r = 0; r < 260; r += 20) {
    for (const [x, y] of [[cx + r, cy], [cx - r, cy], [cx, cy + r], [cx, cy - r]]) {
      const el = document.elementFromPoint(x, y);
      if (el && !el.closest('.canvas-node') && el.tagName !== 'IFRAME' && el.tagName !== 'WEBVIEW'
        && (el.closest('.canvas-container') || String(el.className).includes('canvas'))) {
        return { x, y };
      }
    }
  }
  return null;
})()`);

/**
 * JS-dispatched ctrl+wheel, NOT CDP Input.dispatchMouseEvent: on real
 * Electron the synthesized modifiers:2 wheel never reaches the page's zoom
 * handler (run #121), while in plain Chromium both paths zoom identically.
 * The WheelEvent drives the exact same app handler + render pipeline the
 * probe measures. deltaY 20/tick keeps each band spread over enough frames.
 */
const wheelBurst = (cdp, point, deltaY, ticks) => evaluate(cdp, `(async () => {
  const el = document.elementFromPoint(${point.x}, ${point.y});
  for (let i = 0; i < ${ticks}; i++) {
    el.dispatchEvent(new WheelEvent('wheel', {
      ctrlKey: true, deltaX: 0, deltaY: ${deltaY},
      clientX: ${point.x}, clientY: ${point.y}, bubbles: true, cancelable: true,
    }));
    await new Promise((r) => setTimeout(r, 24));
  }
  return true;
})()`);

/**
 * Wheel toward a target scale in small bursts (so the whole traversal is
 * ONE gesture) until the visible transform crosses it or the tick budget
 * runs out. Returns the reached scale. dir<0 zooms out, dir>0 in.
 */
const wheelToScale = async (cdp, point, dir, target, budget = 40) => {
  let scale = await readScale(cdp);
  let spent = 0;
  while (spent < budget) {
    if (dir < 0 ? scale <= target : scale >= target) break;
    await wheelBurst(cdp, point, dir < 0 ? 20 : -20, 2);
    spent += 2;
    scale = await readScale(cdp);
  }
  return scale;
};

const perfWindow = async (cdp, name, fn) => {
  await evaluate(cdp, `window.__pulsePerf.begin(${JSON.stringify(name)})`);
  await fn();
  await evaluate(cdp, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  const r = await evaluate(cdp, 'window.__pulsePerf.end()');
  return {
    over20: r.frames.over20msPct,
    p95: r.frames.p95DeltaMs,
    max: r.frames.maxDeltaMs ?? 0,
    longTasks: r.longTasks.totalMs,
    window: Math.round(r.durationMs),
  };
};

/** Build the seed node set for the active profile. */
const buildNodes = (probeUrl) => {
  if (PROFILE === 'grid') {
    const GRID = 5, center = 2, nodes = [];
    let i = 0;
    for (let row = 0; row < GRID; row++) {
      for (let col = 0; col < GRID; col++) {
        if (row === center && col === center) continue;
        const url = i % 2 === 0;
        nodes.push({
          id: 'zoom-probe-' + i, type: 'iframe', title: (url ? 'web ' : 'inline ') + i,
          x: -1200 + col * STRIDE_X, y: -900 + row * STRIDE_Y,
          width: NODE_W, height: NODE_H, updatedAt: Date.now(),
          data: url ? { url: probeUrl, mode: 'url', prompt: '', html: '' }
            : { url: '', mode: 'html', prompt: '', html: ANIMATED_HTML },
        });
        i++;
      }
    }
    return { nodes, embeds: nodes.length };
  }
  // large: 86 nodes / 40 embeds (20 url webview + 20 inline html) + 46 text,
  // laid in a 10-wide grid with the viewport-center cell left blank.
  const COLS = 10, TOTAL = 86, EMBEDS = 40, WEBVIEWS = 20;
  const blankCol = 4, blankRow = 4; // near viewport center at scale 1
  const nodes = [];
  let placed = 0, embeds = 0;
  for (let cell = 0; placed < TOTAL; cell++) {
    const col = cell % COLS, row = Math.floor(cell / COLS);
    if (col === blankCol && row === blankRow) continue;
    const x = -1200 + col * STRIDE_X, y = -900 + row * STRIDE_Y;
    if (embeds < EMBEDS) {
      const url = embeds < WEBVIEWS;
      nodes.push({
        id: 'zoom-probe-e' + embeds, type: 'iframe', title: (url ? 'web ' : 'inline ') + embeds,
        x, y, width: NODE_W, height: NODE_H, updatedAt: Date.now(),
        data: url ? { url: probeUrl, mode: 'url', prompt: '', html: '' }
          : { url: '', mode: 'html', prompt: '', html: ANIMATED_HTML },
      });
      embeds++;
    } else {
      const n = placed - embeds;
      nodes.push({
        id: 'zoom-probe-t' + n, type: 'text', title: 'text ' + n,
        x, y, width: 220, height: 140, updatedAt: Date.now(),
        data: { text: 'probe text node ' + n + ' — content for overview thumbnail cost' },
      });
    }
    placed++;
  }
  return { nodes, embeds };
};

const runCycle = async (cdp, point, tileMem) => {
  const before = tileMem.count;
  await wheelToScale(cdp, point, 1, 1.0); // reset to ~1 (first cycle is already there)
  await sleep(300);
  const zoomOutHi = await perfWindow(cdp, 'zoomOut_1_035', () => wheelToScale(cdp, point, -1, 0.35));
  const zoomOutLo = await perfWindow(cdp, 'zoomOut_035_01', () => wheelToScale(cdp, point, -1, 0.1));
  const settle = await perfWindow(cdp, 'overviewSettle', () => sleep(1200));
  const zoomIn = await perfWindow(cdp, 'zoomIn_01_1', () => wheelToScale(cdp, point, 1, 1.0));
  const settleIn = await perfWindow(cdp, 'zoomInSettle', () => sleep(1200));
  await sleep(300);
  return { zoomOutHi, zoomOutLo, settle, zoomIn, settleIn, tileMem: tileMem.count - before };
};

const main = async () => {
  await new Promise((ok) => probeServer.listen(0, '127.0.0.1', ok));
  const probeUrl = `http://127.0.0.1:${probeServer.address().port}/`;
  const session = await requireLiveSession();

  await withPage(session, async (cdp) => {
    for (let i = 0; i < 60; i++) {
      const ready = await evaluate(cdp, `document.querySelectorAll('.canvas-node').length`).catch(() => 0);
      if (ready >= 1) break;
      await sleep(500);
      if (i === 59) fail('canvas did not boot within 30s');
    }

    const { nodes, embeds } = buildNodes(probeUrl);
    await evaluate(cdp, `(async () => {
      const store = window.canvasWorkspace.store;
      await store.save(${JSON.stringify(PROBE_WS_ID)}, {
        nodes: ${JSON.stringify(nodes)}, edges: [],
        transform: { x: innerWidth / 2, y: innerHeight / 2, scale: 1 },
      });
      const manifest = await store.load('__workspaces__');
      const m = manifest.ok && manifest.data ? manifest.data : { workspaces: [], folders: [] };
      const workspaces = (m.workspaces ?? []).filter((w) => w.id !== ${JSON.stringify(PROBE_WS_ID)});
      workspaces.push({ id: ${JSON.stringify(PROBE_WS_ID)}, name: 'Zoom Probe' });
      await store.save('__workspaces__', { ...m, workspaces, activeId: ${JSON.stringify(PROBE_WS_ID)} });
      return true;
    })()`);
    await evaluate(cdp, 'location.reload()');
    await cdp.reconnect();

    // tile-memory warnings surface as browser-level Log entries — the exact
    // signal the removed will-change used to trigger. Subscribe AFTER the
    // reload (reconnect clears listeners on socket close).
    const tileMem = { count: 0 };
    await cdp.send('Log.enable').catch(() => {});
    cdp.on('Log.entryAdded', (params) => {
      if (/tile memory/i.test(params?.entry?.text ?? '')) tileMem.count += 1;
    });

    let mounted = 0;
    for (let i = 0; i < 100; i++) {
      await sleep(500);
      mounted = await evaluate(cdp, `document.querySelectorAll('.canvas-node--iframe').length`).catch(() => 0);
      if (mounted >= embeds) break;
    }
    if (mounted < embeds) fail(`only ${mounted}/${embeds} iframe nodes after reload`);

    const point = await blankPoint(cdp);
    if (!point) fail('no blank wheel point at viewport center');
    const scale0 = await readScale(cdp);

    // Calibrate to ~1 (boot-fit lands anywhere); doubles as wheel-efficacy check.
    let scaleNow = await wheelToScale(cdp, point, 1, 0.99, 28);
    scaleNow = await wheelToScale(cdp, point, -1, 1.2, 28);
    scaleNow = await readScale(cdp);
    if (scaleNow < 0.9 || scaleNow > 1.6) {
      await dumpDiag(cdp, point);
      fail(`calibration could not reach scale≈1 (start=${scale0}, now=${scaleNow}) — wheel likely not reaching the canvas`);
    }

    // Warm-up: cross the overview threshold once so first-swap costs and the
    // one-way deferred mount don't pollute the measured cycles.
    await wheelToScale(cdp, point, -1, 0.1);
    await sleep(1500);
    await wheelToScale(cdp, point, 1, 1.0);
    await sleep(1800);
    const warm = await embedCounts(cdp);
    info('probe state', `profile=${PROFILE} nodes=${nodes.length} embeds=${embeds} · live inline=${warm.inline} webviews=${warm.webviews} · repeat=${REPEAT}`);
    if (warm.inline + warm.webviews < Math.min(6, embeds)) fail(`too few live embeds after warm-up (${warm.inline}+${warm.webviews})`);

    const cycles = [];
    for (let r = 0; r < REPEAT; r++) {
      const c = await runCycle(cdp, point, tileMem);
      cycles.push(c);
      if (c.zoomOutHi.window < 30 && c.zoomOutLo.window < 30) {
        await dumpDiag(cdp, point);
        fail('zoom-out gesture did not move the transform (empty windows)');
      }
    }

    const M = (sel) => median(cycles.map(sel));
    const m = {
      zoomOutOver20: Math.max(M((c) => c.zoomOutHi.over20), M((c) => c.zoomOutLo.over20)),
      zoomOutP95: Math.max(M((c) => c.zoomOutHi.p95), M((c) => c.zoomOutLo.p95)),
      zoomOutMax: Math.max(M((c) => c.zoomOutHi.max), M((c) => c.zoomOutLo.max)),
      settleOver20: M((c) => c.settle.over20),
      zoomInOver20: M((c) => c.zoomIn.over20),
      tileMemWorst: Math.max(...cycles.map((c) => c.tileMem)),
    };

    info('zoomOut 1→0.35 (median)', `frames>20ms=${M((c) => c.zoomOutHi.over20)}% p95=${M((c) => c.zoomOutHi.p95)}ms max=${M((c) => c.zoomOutHi.max)}ms longTasks=${M((c) => c.zoomOutHi.longTasks)}ms`);
    info('zoomOut 0.35→0.1 (median)', `frames>20ms=${M((c) => c.zoomOutLo.over20)}% p95=${M((c) => c.zoomOutLo.p95)}ms max=${M((c) => c.zoomOutLo.max)}ms longTasks=${M((c) => c.zoomOutLo.longTasks)}ms`);
    info('overview settle (median)', `frames>20ms=${M((c) => c.settle.over20)}% p95=${M((c) => c.settle.p95)}ms max=${M((c) => c.settle.max)}ms`);
    info('zoomIn 0.1→1 (median)', `frames>20ms=${M((c) => c.zoomIn.over20)}% p95=${M((c) => c.zoomIn.p95)}ms max=${M((c) => c.zoomIn.max)}ms longTasks=${M((c) => c.zoomIn.longTasks)}ms`);
    info('zoom-in settle (median)', `frames>20ms=${M((c) => c.settleIn.over20)}% p95=${M((c) => c.settleIn.p95)}ms`);
    info('tile-memory warnings', `per-cycle=[${cycles.map((c) => c.tileMem).join(',')}] worst=${m.tileMemWorst}`);

    console.log('\n── acceptance-line comparison (informational, never gates) ──');
    let allPass = true;
    for (const [label, spec] of Object.entries(ACCEPTANCE)) {
      const v = spec.get(m);
      const pass = v <= spec.max;
      if (!pass) allPass = false;
      console.log(`  ${pass ? 'PASS' : 'OVER'}  ${label}: ${v}${spec.unit} (line <= ${spec.max}${spec.unit})`);
    }
    console.log(`\nVERDICT: PROBE OK (diagnostic only, no gate) — acceptance lines ${allPass ? 'all met' : 'NOT all met (baseline, not a failure)'}`);
  });

  probeServer.close();
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
