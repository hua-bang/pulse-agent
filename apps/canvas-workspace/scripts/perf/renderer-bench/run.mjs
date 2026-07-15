// Renderer-only bench: drives the built renderer bundle (dist/renderer) in
// plain Chromium with a stubbed window.canvasWorkspace and an 86-node fixture
// (see fixture.mjs), measuring mount/idle/pan/zoom/drag per variant.
//
// This is the fallback rig for environments where the Electron binary cannot
// be downloaded (egress-blocked sandboxes) — the real pipeline is
// `pnpm perf:report` (scripts/perf/report.mjs) and stays the SSOT for gated
// numbers. Same-process <iframe srcDoc> stands in for <webview> guests here,
// so webview process/memory behavior is out of scope for this rig.
//
//   pnpm --filter canvas-workspace build
//   node scripts/perf/renderer-bench/run.mjs [full|static-iframes|no-iframes ...]
//   HEADED=1 xvfb-run -a node scripts/perf/renderer-bench/run.mjs   # real compositor path
//
// Output: results.json next to this file + JSON per variant on stdout.
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
  const testPkg = require.resolve('@playwright/test/package.json');
  return createRequire(testPkg)('playwright-core');
};
const { chromium } = resolvePlaywrightCore();

const DIST = join(APP_ROOT, 'dist/renderer');
const OUT = join(HERE, 'results.json');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };

const serve = () => new Promise((ok) => {
  const srv = createServer(async (req, res) => {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    try {
      const body = await readFile(join(DIST, decodeURIComponent(path)));
      res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404); res.end('nope');
    }
  });
  srv.listen(0, '127.0.0.1', () => ok(srv));
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const cdpDelta = async (cdp, fn) => {
  const grab = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]));
  const a = await grab();
  await fn();
  const b = await grab();
  const d = (k) => Math.round(((b[k] ?? 0) - (a[k] ?? 0)) * 1000) / 1000;
  return {
    taskDurationS: d('TaskDuration'), scriptDurationS: d('ScriptDuration'),
    layoutCount: d('LayoutCount'), recalcStyleCount: d('RecalcStyleCount'),
    jsHeapUsedMB: Math.round((b.JSHeapUsedSize ?? 0) / 1048576),
    domNodes: b.Nodes,
  };
};

const blankPoint = async (page) => page.evaluate(() => {
  for (let y = 120; y < innerHeight - 60; y += 60) {
    for (let x = 200; x < innerWidth - 60; x += 80) {
      const el = document.elementFromPoint(x, y);
      if (!el) continue;
      if (el.closest('.canvas-node') || el.tagName === 'IFRAME' || el.closest('[class*="sidebar" i]') || el.closest('[class*="dock" i]')) continue;
      if (el.closest('.canvas-container') || (el.className && String(el.className).includes('canvas'))) return { x, y };
    }
  }
  return { x: Math.round(innerWidth / 2), y: Math.round(innerHeight / 2) };
});

const perfWindow = async (page, name, fn) => {
  await page.evaluate((n) => window.__pulsePerf.begin(n), name);
  await fn();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => window.__pulsePerf.end());
};

const runVariant = async (browser, baseUrl, variant) => {
  const fixture = buildFixture(variant);
  const expected = fixture.nodes.length;
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(buildInitScript(fixture));
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');

  const t0 = Date.now();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('.canvas-node').length >= n, expected, { timeout: 60_000 });
  const mountMs = Date.now() - t0;

  const mountFacts = await page.evaluate(() => {
    const iframes = [...document.querySelectorAll('.canvas-node iframe')];
    const offscreen = iframes.filter((f) => {
      const r = f.getBoundingClientRect();
      return r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight;
    }).length;
    const lt = window.__benchLongTasks;
    return {
      canvasNodes: document.querySelectorAll('.canvas-node').length,
      iframesMounted: iframes.length, iframesOffscreen: offscreen,
      longTasks: lt.length, longTaskTotalMs: lt.reduce((s, t) => s + t.dur, 0), longTaskMaxMs: Math.max(0, ...lt.map((t) => t.dur)),
      errors: window.__benchErrors.slice(0, 10),
    };
  });

  await sleep(3000); // settle

  const idleReport = { pulse: null, cdp: null };
  idleReport.cdp = await cdpDelta(cdp, async () => {
    idleReport.pulse = await perfWindow(page, 'idle10', () => sleep(10_000));
  });

  const pt = await blankPoint(page);
  await page.mouse.move(pt.x, pt.y);
  const panReport = await perfWindow(page, 'pan', async () => {
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 80); await sleep(16); }
    for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, -80); await sleep(16); }
  });

  const zoomReport = await perfWindow(page, 'zoom', async () => {
    await page.keyboard.down('Control');
    for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, -60); await sleep(16); }
    for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, 60); await sleep(16); }
    await page.keyboard.up('Control');
  });

  const pickTarget = (selector) => page.evaluate((sel) => {
    const el = [...document.querySelectorAll(sel)].find((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 50 && r.top > 40 && r.left > 100 && r.bottom < innerHeight && r.right < innerWidth;
    });
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + 12) };
  }, selector);
  const dragAt = async (target) => perfWindow(page, 'drag', async () => {
    await page.mouse.move(target.x, target.y);
    await page.mouse.down();
    for (let i = 1; i <= 60; i++) { await page.mouse.move(target.x + i * 3, target.y + i * 2); await sleep(8); }
    await page.mouse.up();
  });

  const textTarget = await pickTarget('.canvas-node--text');
  const dragTextReport = textTarget ? await dragAt(textTarget) : null;
  const iframeTarget = await pickTarget('.canvas-node--iframe');
  const dragIframeReport = iframeTarget ? await dragAt(iframeTarget) : null;

  // Visit the whole canvas (paint every node at least once), then park and
  // measure steady-state again.
  await page.mouse.move(pt.x, pt.y);
  for (let sweep = 0; sweep < 6; sweep++) {
    for (let i = 0; i < 30; i++) { await page.mouse.wheel(sweep % 2 ? -160 : 160, 90); await sleep(8); }
  }
  await sleep(2000);
  const postVisit = { pulse: null, cdp: null };
  postVisit.cdp = await cdpDelta(cdp, async () => {
    postVisit.pulse = await perfWindow(page, 'idle10-postvisit', () => sleep(10_000));
  });
  const postVisitFacts = await page.evaluate(() => {
    const iframes = [...document.querySelectorAll('.canvas-node iframe')];
    const onscreen = iframes.filter((f) => {
      const r = f.getBoundingClientRect();
      return !(r.right < 0 || r.bottom < 0 || r.left > innerWidth || r.top > innerHeight);
    }).length;
    return { iframesOnscreen: onscreen, iframesTotal: iframes.length };
  });

  const finalErrors = await page.evaluate(() => window.__benchErrors.slice(0, 20));
  const heapMB = await page.evaluate(() => Math.round(performance.memory.usedJSHeapSize / 1048576));
  await ctx.close();

  const pick = (r) => r && {
    frames: r.frames, longTasks: r.longTasks, loafBlockingMs: r.longAnimationFrames.blockingMs,
    counters: r.counters, interactionsP95: r.interactions.p95, heap: r.jsHeapMB,
  };
  return {
    variant, expected, mountMs, mountFacts, heapMB,
    idle10s: { pulse: pick(idleReport.pulse), cdp: idleReport.cdp },
    pan: pick(panReport), zoom: pick(zoomReport),
    dragText: pick(dragTextReport), dragIframe: pick(dragIframeReport),
    postVisitIdle10s: { pulse: pick(postVisit.pulse), cdp: postVisit.cdp, facts: postVisitFacts },
    finalErrors,
  };
};

const findChrome = () => {
  for (const p of ['/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome']) {
    try { require('node:fs').accessSync(p); return p; } catch {}
  }
  return undefined; // let playwright-core resolve its own registry install
};

const main = async () => {
  const variants = process.argv.slice(2).length ? process.argv.slice(2) : ['full', 'static-iframes', 'no-iframes'];
  const srv = await serve();
  const baseUrl = `http://127.0.0.1:${srv.address().port}/index.html`;
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: process.env.HEADED !== '1',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const results = [];
  for (const v of variants) {
    console.log(`--- variant: ${v}`);
    try {
      const r = await runVariant(browser, baseUrl, v);
      results.push(r);
      console.log(JSON.stringify(r, null, 1));
    } catch (err) {
      console.error(`variant ${v} failed:`, err.message);
      results.push({ variant: v, error: String(err.message) });
    }
  }
  await browser.close();
  srv.close();
  await writeFile(OUT, JSON.stringify(results, null, 2));
  console.log('written', OUT);
};

main().catch((e) => { console.error(e); process.exit(1); });
