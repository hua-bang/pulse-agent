#!/usr/bin/env node
/**
 * Deep zoom-gesture probe — DIAGNOSTIC, never gated. Answers the one
 * mid-gesture question the Chromium renderer bench cannot: what does a
 * deep ctrl+wheel zoom-out (scale 1 → ~0.1, crossing the 0.35-1 band
 * where live embeds still paint) cost on REAL Electron, with the two
 * embed kinds the rig can't tell apart — same-process inline iframes
 * (html/srcdoc) vs cross-process <webview> guests (url mode, OOPIF
 * surfaces that scale on the compositor instead of re-rastering in the
 * embedder). The rig measured 21% frames >20ms for this band with 40
 * same-process iframes; whether that survives real guest architecture
 * decides the "gesture-time static overlay" candidate
 * (docs/performance-verification-large-canvas.md).
 *
 * Usage (harness session must be live, same pattern as
 * webview-lifecycle-check.mjs):
 *   node harness/tools/driver/cli.mjs start --profile temp --headless
 *   node scripts/perf/zoom-gesture-probe.mjs
 *   node harness/tools/driver/cli.mjs close --cleanup
 *
 * Seeds a DEDICATED workspace (the welcome canvas has a boot-fit save
 * race — see the lifecycle check) with a 5×5 grid of embeds around a
 * blank center strip (wheel events over an embed are consumed by it and
 * never reach the canvas): half inline html iframes with animated
 * content, half url webviews served by this script. One warm-up
 * zoom-out/in cycle mounts everything (deferred mount is a one-way
 * gate), then three measured windows: deepZoomOut (the 0.35-1 band),
 * overviewSettle (semantic-swap spike), deepZoomIn (return + swap-back).
 * Prints INFO numbers and exits 0; non-zero only when the probe itself
 * malfunctions (gesture didn't move the transform, embeds never
 * mounted).
 */
import { createServer } from 'node:http';
import { requireLiveSession } from '../../harness/tools/driver/src/session.mjs';
import { withPage } from '../../harness/tools/driver/src/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PROBE_WS_ID = 'zoom-probe-ws';
const GRID = 5;
const NODE_W = 520;
const NODE_H = 400;
const STRIDE_X = 560;
const STRIDE_Y = 440;
const WHEEL_TICKS = 22;

// Animated so mid-gesture raster is non-trivial (a static page would
// undersell the cost the rig measured on animated fixtures).
const ANIMATED_HTML = `<!doctype html><html><head><style>
  body { margin: 0; font: 14px sans-serif; }
  .spin { width: 60px; height: 60px; margin: 20px; background: #4a90d9;
    border-radius: 8px; animation: r 1.6s linear infinite; }
  @keyframes r { to { transform: rotate(360deg); } }
</style></head><body>
  <div class="spin"></div>
  <div id="t"></div>
  <script>
    const t = document.getElementById('t');
    let n = 0;
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

const readScale = (cdp) => evaluate(cdp, `(() => {
  const el = document.querySelector('.canvas-transform');
  const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return Math.round(m.a * 1000) / 1000;
})()`);

/** Wheel at a blank canvas point near the viewport center (embeds eat
 * wheel events — the grid leaves its center cell empty for this). */
const blankPoint = (cdp) => evaluate(cdp, `(() => {
  const cx = Math.round(innerWidth / 2), cy = Math.round(innerHeight / 2);
  for (let r = 0; r < 200; r += 20) {
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

const wheelBurst = async (cdp, point, deltaY) => {
  for (let i = 0; i < WHEEL_TICKS; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: point.x, y: point.y, deltaX: 0, deltaY, modifiers: 2,
    });
    await sleep(16);
  }
};

const perfWindow = async (cdp, name, fn) => {
  await evaluate(cdp, `window.__pulsePerf.begin(${JSON.stringify(name)})`);
  await fn();
  await evaluate(cdp, 'new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
  return evaluate(cdp, 'window.__pulsePerf.end()');
};

const fmt = (r) => `frames>20ms=${r.frames.over20msPct}% p95=${r.frames.p95DeltaMs}ms ` +
  `longTasks=${r.longTasks.totalMs}ms window=${Math.round(r.durationMs)}ms`;

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

    // 5×5 grid, center cell left blank for the wheel point; alternate
    // url webviews and inline html iframes. Viewport starts at scale 1
    // over the grid's center, so a handful of embeds are live before the
    // warm-up and the rest mount during it.
    await evaluate(cdp, `(async () => {
      const store = window.canvasWorkspace.store;
      const nodes = [];
      const center = Math.floor(${GRID} / 2);
      let i = 0;
      for (let row = 0; row < ${GRID}; row++) {
        for (let col = 0; col < ${GRID}; col++) {
          if (row === center && col === center) continue;
          const url = i % 2 === 0;
          nodes.push({
            id: 'zoom-probe-' + i, type: 'iframe',
            title: (url ? 'web ' : 'inline ') + i,
            x: -1200 + col * ${STRIDE_X}, y: -900 + row * ${STRIDE_Y},
            width: ${NODE_W}, height: ${NODE_H}, updatedAt: Date.now(),
            data: url
              ? { url: ${JSON.stringify(probeUrl)}, mode: 'url', prompt: '', html: '' }
              : { url: '', mode: 'html', prompt: '', html: ${JSON.stringify(ANIMATED_HTML)} },
          });
          i++;
        }
      }
      await store.save(${JSON.stringify(PROBE_WS_ID)}, {
        nodes, edges: [],
        // Viewport center lands on the grid center (the blank cell).
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
    let mounted = 0;
    for (let i = 0; i < 80; i++) {
      await sleep(500);
      mounted = await evaluate(cdp, `document.querySelectorAll('.canvas-node--iframe').length`).catch(() => 0);
      if (mounted >= GRID * GRID - 1) break;
    }
    if (mounted < GRID * GRID - 1) fail(`only ${mounted} iframe nodes after reload`);

    const point = await blankPoint(cdp);
    if (!point) fail('no blank wheel point at viewport center');
    const scale0 = await readScale(cdp);

    // Warm-up: mount everything (one-way deferred mount), then return.
    await wheelBurst(cdp, point, 60);
    await sleep(1500);
    await wheelBurst(cdp, point, -60);
    await sleep(1800);
    const warm = await evaluate(cdp, `({
      inline: document.querySelectorAll('.canvas-node--iframe iframe:not(.iframe-frame--pending)').length,
      webviews: document.querySelectorAll('.canvas-node--iframe webview').length,
    })`);
    const scaleWarm = await readScale(cdp);
    info('probe state', `scale start=${scale0} after-warmup=${scaleWarm}, live inline=${warm.inline}, webviews=${warm.webviews}`);
    if (warm.inline + warm.webviews < 6) fail(`too few live embeds after warm-up (${warm.inline}+${warm.webviews})`);

    const zoomOut = await perfWindow(cdp, 'deepZoomOut', () => wheelBurst(cdp, point, 60));
    const scaleOut = await readScale(cdp);
    const settle = await perfWindow(cdp, 'overviewSettle', () => sleep(1200));
    const zoomIn = await perfWindow(cdp, 'deepZoomIn', () => wheelBurst(cdp, point, -60));
    const settleIn = await perfWindow(cdp, 'zoomInSettle', () => sleep(1200));
    const scaleEnd = await readScale(cdp);
    if (scaleOut === scaleWarm) fail('zoom-out gesture did not change the transform');

    info('deep zoom-out (live embeds, the 0.35-1 band)', `${fmt(zoomOut)} — scale ${scaleWarm} → ${scaleOut}`);
    info('overview settle (semantic swap)', fmt(settle));
    info('deep zoom-in (return)', `${fmt(zoomIn)} — scale ${scaleOut} → ${scaleEnd}`);
    info('zoom-in settle (swap back to live)', fmt(settleIn));
    console.log('\nVERDICT: PROBE OK (diagnostic only, no gate)');
  });

  probeServer.close();
  // Same explicit exit as webview-lifecycle-check.mjs: lingering guest
  // sockets can keep the event loop alive after the verdict.
  process.exit(0);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
