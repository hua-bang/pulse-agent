// Attribution mode for the renderer bench: traces the two janky gestures
// (zoom, live-iframe drag) plus an idle window on the `full` fixture and
// breaks frame cost down by thread × event (script vs style/layout vs paint
// vs raster), answering "why is it slow", not just "how slow".
//
//   pnpm --filter canvas-workspace build
//   HEADED=1 xvfb-run -a node scripts/perf/renderer-bench/trace.mjs
//
// Output: trace-summary.json next to this file + per-scenario tables on
// stdout. Diagnostic only, never gated.
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildFixture } from './fixture.mjs';
import { buildInitScript } from './stub.mjs';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const APP_ROOT = resolve(HERE, '../../..');
const require = createRequire(join(APP_ROOT, 'package.json'));
const resolvePlaywrightCore = () => {
  try { return require('playwright-core'); } catch {}
  return createRequire(require.resolve('@playwright/test/package.json'))('playwright-core');
};
const { chromium } = resolvePlaywrightCore();

const DIST = join(APP_ROOT, 'dist/renderer');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };

const serve = () => new Promise((ok) => {
  const srv = createServer(async (req, res) => {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    try {
      const body = await readFile(join(DIST, decodeURIComponent(path)));
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch { res.writeHead(404); res.end('nope'); }
  });
  srv.listen(0, '127.0.0.1', () => ok(srv));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const findChrome = () => {
  for (const p of ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']) {
    try { require('node:fs').accessSync(p); return p; } catch {}
  }
  return undefined;
};

const TRACE_CATEGORIES = [
  '-*', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'toplevel', 'v8.execute',
];

// Buckets that make the breakdown readable. Order matters (first match wins).
const BUCKETS = [
  ['script', ['FunctionCall', 'EvaluateScript', 'V8.Execute', 'TimerFire', 'FireAnimationFrame', 'EventDispatch', 'v8.run', 'V8.RunMicrotasks', 'RunMicrotasks']],
  ['style-layout', ['UpdateLayoutTree', 'Layout', 'ScheduleStyleRecalculation', 'RecalculateStyles', 'PrePaint', 'UpdateLayerTree', 'HitTest']],
  ['paint', ['Paint', 'PaintImage', 'RecordPaint']],
  ['raster', ['RasterTask', 'Rasterize', 'ImageDecodeTask', 'DecodeImage', 'Decode Image']],
  ['composite', ['CompositeLayers', 'Commit', 'ActivateLayerTree', 'DrawFrame', 'BeginFrame', 'NeedsBeginFrameChanged', 'ProxyImpl::ScheduledActionDraw']],
  ['input', ['HandleInputEvent', 'InputLatency', 'LatencyInfo']],
];
const bucketOf = (name) => {
  for (const [bucket, names] of BUCKETS) if (names.some((n) => name === n || name.startsWith(n))) return bucket;
  return null;
};

const summarizeTrace = (events) => {
  const threadNames = new Map();
  for (const e of events) {
    if (e.ph === 'M' && e.name === 'thread_name') threadNames.set(`${e.pid}:${e.tid}`, e.args?.name ?? 'unknown');
  }
  const byThreadBucket = new Map();
  const byName = new Map();
  for (const e of events) {
    if (e.ph !== 'X' || !e.dur) continue;
    const thread = threadNames.get(`${e.pid}:${e.tid}`) ?? 'unknown';
    const bucket = bucketOf(e.name);
    byName.set(e.name, (byName.get(e.name) ?? 0) + e.dur);
    if (!bucket) continue;
    // RunTask double-counts its children — bucketed names are leaf-ish.
    const key = `${thread}|${bucket}`;
    byThreadBucket.set(key, (byThreadBucket.get(key) ?? 0) + e.dur);
  }
  const rows = [...byThreadBucket.entries()]
    .map(([key, us]) => ({ thread: key.split('|')[0], bucket: key.split('|')[1], ms: Math.round(us / 100) / 10 }))
    .sort((a, b) => b.ms - a.ms);
  const topNames = [...byName.entries()]
    .map(([name, us]) => ({ name, ms: Math.round(us / 100) / 10 }))
    .sort((a, b) => b.ms - a.ms).slice(0, 18);
  return { rows, topNames };
};

const perfWindow = async (page, name, fn) => {
  await page.evaluate((n) => window.__pulsePerf.begin(n), name);
  await fn();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => window.__pulsePerf.end());
};

const observeLoaf = (page) => page.evaluate(() => {
  window.__loafDetails = [];
  window.__loafObserver = new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      window.__loafDetails.push({
        dur: Math.round(e.duration), blocking: Math.round(e.blockingDuration ?? 0),
        scripts: (e.scripts ?? []).map((s) => ({ invoker: s.invoker, dur: Math.round(s.duration) })).slice(0, 4),
      });
    }
  });
  window.__loafObserver.observe({ type: 'long-animation-frame', buffered: false });
});
const collectLoaf = (page) => page.evaluate(() => {
  window.__loafObserver?.disconnect();
  return window.__loafDetails ?? [];
});

const main = async () => {
  const fixture = buildFixture('full');
  const srv = await serve();
  const baseUrl = `http://127.0.0.1:${srv.address().port}/index.html`;
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: process.env.HEADED !== '1',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(buildInitScript(fixture));
  const page = await ctx.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('.canvas-node').length >= n, fixture.nodes.length, { timeout: 60_000 });
  await sleep(3000);

  // Wheel events landing on a node/iframe are consumed there and never reach
  // the canvas handler (same trap as perf plan A4) — zoom MUST target a blank
  // canvas point and the transform must be asserted to have changed.
  const blankPoint = () => page.evaluate(() => {
    for (let y = 120; y < innerHeight - 60; y += 60) {
      for (let x = 200; x < innerWidth - 60; x += 80) {
        const el = document.elementFromPoint(x, y);
        if (!el) continue;
        if (el.closest('.canvas-node') || el.tagName === 'IFRAME' || el.closest('[class*="sidebar" i]') || el.closest('[class*="dock" i]')) continue;
        if (el.closest('.canvas-container') || (el.className && String(el.className).includes('canvas'))) return { x, y };
      }
    }
    return null;
  });
  const readTransform = () => page.evaluate(() => {
    const el = document.querySelector('.canvas-container [style*="transform"], .canvas-content, [class*="canvas"] > div[style*="scale"]');
    return el ? el.style.transform : null;
  });
  const dragVisibleIframe = async () => {
    const t = await page.evaluate(() => {
      const el = [...document.querySelectorAll('.canvas-node--iframe')].find((n) => {
        const r = n.getBoundingClientRect();
        return r.top > 40 && r.left > 100 && r.bottom < innerHeight && r.right < innerWidth;
      });
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 12) };
    });
    if (!t) throw new Error('no visible iframe node to drag');
    await page.mouse.move(t.x, t.y);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) { await page.mouse.move(t.x + i * 3, t.y + i * 2); await sleep(8); }
    await page.mouse.up();
  };

  const transforms = {};
  const scenarios = {
    idle10: async () => { await sleep(10_000); },
    dragIframeAtScale1: dragVisibleIframe,
    zoom: async () => {
      const pt = await blankPoint();
      if (!pt) throw new Error('no blank canvas point for zoom');
      transforms.beforeZoom = await readTransform();
      await page.mouse.move(pt.x, pt.y);
      await page.keyboard.down('Control');
      for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, -60); await sleep(16); }
      for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, 60); await sleep(16); }
      await page.keyboard.up('Control');
      transforms.afterZoom = await readTransform();
      if (transforms.afterZoom === transforms.beforeZoom) throw new Error('zoom did not reach the canvas (transform unchanged)');
    },
    dragIframePostZoom: dragVisibleIframe,
  };

  const out = {};
  for (const [name, gesture] of Object.entries(scenarios)) {
    await observeLoaf(page);
    await browser.startTracing(page, { categories: TRACE_CATEGORIES });
    const pulse = await perfWindow(page, `trace-${name}`, gesture);
    const buf = await browser.stopTracing();
    const loaf = await collectLoaf(page);
    const events = JSON.parse(buf.toString()).traceEvents ?? JSON.parse(buf.toString());
    const summary = summarizeTrace(events);
    out[name] = {
      windowMs: pulse.durationMs,
      framesOver20Pct: pulse.frames.over20msPct,
      breakdown: summary.rows,
      topEvents: summary.topNames,
      loafTop: loaf.sort((a, b) => b.dur - a.dur).slice(0, 5),
    };
    console.log(`\n=== ${name} (${pulse.durationMs}ms window, ${pulse.frames.over20msPct}% frames >20ms)`);
    for (const r of summary.rows.slice(0, 12)) console.log(`  ${r.thread.padEnd(28)} ${r.bucket.padEnd(14)} ${r.ms}ms`);
    console.log('  top events:', summary.topNames.slice(0, 8).map((t) => `${t.name}:${t.ms}ms`).join('  '));
    await sleep(1500);
  }

  out.transforms = transforms;
  await ctx.close();
  await browser.close();
  srv.close();
  await writeFile(join(HERE, 'trace-summary.json'), JSON.stringify(out, null, 2));
  console.log('\ntransforms:', JSON.stringify(transforms));
  console.log('written', join(HERE, 'trace-summary.json'));
};

main().catch((e) => { console.error(e); process.exit(1); });
