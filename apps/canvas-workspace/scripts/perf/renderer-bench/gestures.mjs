// Median-of-N gesture bench WITHOUT tracing overhead: mount facts, idle,
// scale-1 iframe drag, zoom-out-to-overview, overview drag, jank buffer.
// DIST=<renderer dist dir> REPEAT=3 node gestures.mjs
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createRequire } from 'node:module';
import { buildFixture } from './fixture.mjs';
import { buildInitScript } from './stub.mjs';

const require = createRequire(new URL('../../../package.json', import.meta.url).pathname);
const { chromium } = createRequire(require.resolve('@playwright/test/package.json'))('playwright-core');
const DIST = process.env.DIST ?? new URL('../../../dist/renderer', import.meta.url).pathname;
const REPEAT = Number(process.env.REPEAT ?? 3);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const serve = () => new Promise((ok) => {
  const s = createServer(async (req, res) => {
    const p = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    try {
      res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream' });
      res.end(await readFile(join(DIST, decodeURIComponent(p))));
    } catch { res.writeHead(404); res.end(); }
  });
  s.listen(0, '127.0.0.1', () => ok(s));
});

const perfWindow = async (page, name, fn) => {
  await page.evaluate((n) => window.__pulsePerf.begin(n), name);
  await fn();
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  return page.evaluate(() => window.__pulsePerf.end());
};

const blankPoint = (page) => page.evaluate(() => {
  for (let y = 120; y < innerHeight - 60; y += 60) for (let x = 200; x < innerWidth - 60; x += 80) {
    const el = document.elementFromPoint(x, y);
    if (el && !el.closest('.canvas-node') && el.tagName !== 'IFRAME' && (el.closest('.canvas-container') || String(el.className).includes('canvas'))) return { x, y };
  }
  return null;
});

const dragTarget = (page, sel) => page.evaluate((s) => {
  const el = [...document.querySelectorAll(s)].find((n) => {
    const r = n.getBoundingClientRect();
    return r.width > 40 && r.top > 40 && r.left > 100 && r.bottom < innerHeight && r.right < innerWidth;
  });
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + Math.min(12, r.height / 4)) };
}, sel);

const dragAt = async (page, t, name) => perfWindow(page, name, async () => {
  await page.mouse.move(t.x, t.y);
  await page.mouse.down();
  for (let i = 1; i <= 60; i++) { await page.mouse.move(t.x + i * 3, t.y + i * 2); await sleep(8); }
  await page.mouse.up();
});

const runOnce = async (browser, baseUrl) => {
  const fixture = buildFixture('full');
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(buildInitScript(fixture));
  const page = await ctx.newPage();
  const t0 = Date.now();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction((n) => document.querySelectorAll('.canvas-node').length >= n, fixture.nodes.length, { timeout: 60_000 });
  const mountMs = Date.now() - t0;
  const mountFacts = await page.evaluate(() => {
    const iframes = [...document.querySelectorAll('.canvas-node iframe:not(.iframe-frame--pending)')];
    const lt = window.__benchLongTasks;
    return {
      iframesMounted: iframes.length,
      longTaskTotalMs: lt.reduce((s, t) => s + t.dur, 0),
      longTaskMaxMs: Math.max(0, ...lt.map((t) => t.dur)),
      errors: window.__benchErrors.slice(0, 5),
    };
  });
  await sleep(2500);

  const idle = await perfWindow(page, 'idle', () => sleep(10_000));

  const t1 = await dragTarget(page, '.canvas-node--iframe');
  const dragScale1 = t1 ? await dragAt(page, t1, 'dragScale1') : null;

  const pt = await blankPoint(page);
  await page.mouse.move(pt.x, pt.y);
  const zoomOut = await perfWindow(page, 'zoomOut', async () => {
    await page.keyboard.down('Control');
    for (let i = 0; i < 25; i++) { await page.mouse.wheel(0, 60); await sleep(16); }
    await page.keyboard.up('Control');
  });
  await sleep(800); // settle → semantic swap happens here (by design)
  const overviewState = await page.evaluate(() => ({
    cls: document.querySelector('.canvas-transform')?.className ?? '',
    visibleIframes: [...document.querySelectorAll('.canvas-node--iframe .iframe-frame')].filter((f) => getComputedStyle(f).display !== 'none').length,
    mounted: document.querySelectorAll('.canvas-node--iframe iframe').length,
  }));

  const t2 = await dragTarget(page, '.canvas-node--iframe');
  const dragOverview = t2 ? await dragAt(page, t2, 'dragOverview') : null;

  const jank = await page.evaluate(() => (window.__pulseJank ?? []).length
    ? { count: window.__pulseJank.length, last: window.__pulseJank[window.__pulseJank.length - 1] }
    : { count: 0 });

  await ctx.close();
  const f = (r) => r && { over20: r.frames.over20msPct, p95: r.frames.p95DeltaMs, longTasksMs: r.longTasks.totalMs, win: r.durationMs };
  return { mountMs, mountFacts, idle: f(idle), dragScale1: f(dragScale1), zoomOut: f(zoomOut), overviewState, dragOverview: f(dragOverview), jank };
};

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

const main = async () => {
  const srv = await serve();
  const baseUrl = `http://127.0.0.1:${srv.address().port}/index.html`;
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    headless: process.env.HEADED !== '1',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  const runs = [];
  for (let i = 0; i < REPEAT; i++) {
    const r = await runOnce(browser, baseUrl);
    runs.push(r);
    console.log(`run ${i + 1}:`, JSON.stringify(r));
  }
  await browser.close();
  srv.close();
  const med = (path) => median(runs.map((r) => path.split('.').reduce((o, k) => o?.[k], r)).filter((v) => typeof v === 'number'));
  console.log('\n=== medians over', REPEAT, 'runs (DIST=' + DIST + ')');
  for (const m of ['mountMs', 'mountFacts.iframesMounted', 'mountFacts.longTaskTotalMs', 'idle.over20', 'dragScale1.over20', 'zoomOut.over20', 'zoomOut.win', 'dragOverview.over20', 'dragOverview.win']) {
    console.log(`  ${m}: ${med(m)}`);
  }
};

main().catch((e) => { console.error(e); process.exit(1); });
