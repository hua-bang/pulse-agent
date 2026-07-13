#!/usr/bin/env node
/**
 * Real-Electron verification of the webview lifecycle ladder — the checks
 * the Chromium renderer bench cannot perform because they hinge on guest
 * (<webview>) behavior:
 *
 *   1. element `visibility:hidden` propagates to the guest's
 *      document.visibilityState (the precondition for freezing: Chromium's
 *      SetPageFrozen silently ignores VISIBLE pages),
 *   2. `iframe:set-lifecycle 'frozen'` actually stops guest JS + network,
 *   3. resume is instantaneous with ZERO reload (same in-page load stamp),
 *   4. (opt-in, WEBVIEW_CHECK_DISCARD=1 + a tiny
 *      PULSE_CANVAS_WEBVIEW_MEMORY_BUDGET_MB exported before harness start)
 *      the L3 sweep discards the frozen guest: sleeping placeholder DOM
 *      appears and the <webview> element is gone.
 *
 * Prereq — a live harness session launched with the same env:
 *   pnpm --filter canvas-workspace build
 *   PULSE_CANVAS_WEBVIEW_MEMORY_BUDGET_MB=1 \
 *     node harness/tools/driver/cli.mjs start --profile temp --headless
 *   WEBVIEW_CHECK_DISCARD=1 node scripts/perf/webview-lifecycle-check.mjs
 *
 * The probe: a url iframe node pointing at a local HTTP page that pings this
 * script's server every 300ms with its document.visibilityState and its
 * load timestamp. Ping flow/stop/resume IS the ground truth for guest
 * execution. Exit 1 with a labeled verdict on the first failed step.
 */
import { createServer } from 'node:http';
import { requireLiveSession } from '../../harness/tools/driver/src/session.mjs';
import { withPage } from '../../harness/tools/driver/src/cdp.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NODE_ID = 'webview-lifecycle-probe';

const pings = [];
const probeServer = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname === '/ping') {
    pings.push({ at: Date.now(), vis: url.searchParams.get('vis'), t0: url.searchParams.get('t0') });
    res.setHeader('access-control-allow-origin', '*');
    res.end('pong');
    return;
  }
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><html><body><h1>lifecycle probe</h1><script>
    const t0 = String(Date.now());
    setInterval(() => {
      fetch('/ping?vis=' + document.visibilityState + '&t0=' + t0).catch(() => {});
    }, 300);
  </script></body></html>`);
});

const pingsSince = (t) => pings.filter((p) => p.at >= t);
const lastVis = () => pings[pings.length - 1]?.vis;
const lastT0 = () => pings[pings.length - 1]?.t0;

const evaluate = async (cdp, expression) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true, userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`renderer eval failed: ${result.exceptionDetails.text ?? 'unknown'}`);
  }
  return result.result?.value ?? null;
};

const steps = [];
const step = (name, pass, detail) => {
  steps.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
  if (!pass) {
    console.log('\nVERDICT: FAIL');
    process.exit(1);
  }
};

const main = async () => {
  await new Promise((ok) => probeServer.listen(0, '127.0.0.1', ok));
  const probeUrl = `http://127.0.0.1:${probeServer.address().port}/`;
  const session = await requireLiveSession();

  await withPage(session, async (cdp) => {
    // The canvas must be booted before we can seed through the store IPC.
    for (let i = 0; i < 60; i++) {
      const ready = await evaluate(cdp, `document.querySelectorAll('.canvas-node').length`).catch(() => 0);
      if (ready >= 1) break;
      await sleep(500);
      if (i === 59) step('canvas boots', false, 'no .canvas-node within 30s of session start');
    }

    // Seed the url probe node at the CURRENT viewport center — the url
    // webview's deferred mount (D1) only creates the guest when the node is
    // near the viewport, and the welcome canvas restores a saved transform,
    // so a fixed world coordinate can land offscreen and never mount.
    await evaluate(cdp, `(async () => {
      const store = window.canvasWorkspace.store;
      const list = await store.list();
      const wsId = list.ids[0];
      const loaded = await store.load(wsId);
      const data = loaded.data ?? {};
      const t = data.transform ?? { x: 0, y: 0, scale: 1 };
      const cx = (window.innerWidth / 2 - t.x) / t.scale;
      const cy = (window.innerHeight / 2 - t.y) / t.scale;
      const nodes = (Array.isArray(data.nodes) ? data.nodes : []).filter((n) => n.id !== ${JSON.stringify(NODE_ID)});
      nodes.push({
        id: ${JSON.stringify(NODE_ID)}, type: 'iframe', title: 'lifecycle probe',
        x: Math.round(cx - 240), y: Math.round(cy - 160), width: 480, height: 320, updatedAt: Date.now(),
        data: { url: ${JSON.stringify(probeUrl)}, mode: 'url', prompt: '', html: '' },
      });
      await store.save(wsId, { ...data, nodes });
      window.__probeWsId = wsId;
      return wsId;
    })()`);
    const wsId = await evaluate(cdp, 'window.__probeWsId');
    await evaluate(cdp, 'location.reload()');
    await cdp.reconnect();
    let lastPollError = null;
    let mounted = false;
    for (let i = 0; i < 80 && !mounted; i++) {
      await sleep(500);
      mounted = await evaluate(cdp, `!!document.querySelector('.canvas-node--iframe webview')`)
        .catch((err) => { lastPollError = err; return false; });
    }
    if (!mounted) {
      // Surface enough state to diagnose from CI logs alone.
      const diag = await evaluate(cdp, `(async () => {
        const store = window.canvasWorkspace.store;
        // __probeWsId does not survive the reload — fall back to the list.
        const loaded = await store.load(window.__probeWsId ?? (await store.list()).ids[0]);
        const nodes = loaded?.data?.nodes ?? [];
        const probe = nodes.find((n) => n.id === ${JSON.stringify(NODE_ID)});
        const el = [...document.querySelectorAll('.canvas-node--iframe')].map((n) => n.className).join(' | ');
        return {
          canvasNodes: document.querySelectorAll('.canvas-node').length,
          iframeNodes: document.querySelectorAll('.canvas-node--iframe').length,
          webviews: document.querySelectorAll('webview').length,
          storedNodeIds: nodes.map((n) => n.id + ':' + n.type),
          probeStored: probe ? { mode: probe.data?.mode, url: probe.data?.url } : null,
          iframeClasses: el.slice(0, 400),
          transform: document.querySelector('.canvas-transform')?.style.transform ?? null,
        };
      })()`).catch((err) => ({ diagError: String(err) }));
      console.log('DIAG', JSON.stringify(diag));
      if (lastPollError) console.log('DIAG lastPollError', String(lastPollError));
      step('probe webview mounts', false, 'no <webview> appeared in 40s — see DIAG line');
    }
    // Registration completes asynchronously (did-attach IPC) — poll until
    // the lifecycle channel can address the guest.
    let registered = false;
    for (let i = 0; i < 40 && !registered; i++) {
      const r = await evaluate(cdp, `window.canvasWorkspace.iframe.setLifecycle(${JSON.stringify(wsId)}, ${JSON.stringify(NODE_ID)}, 'active')`);
      registered = !!r?.ok;
      if (!registered) await sleep(500);
    }
    step('guest registered', registered, registered ? 'iframe:set-lifecycle can address the guest' : 'registration never completed');

    // 1) Baseline: guest JS + network alive.
    const tBase = Date.now();
    await sleep(3000);
    const base = pingsSince(tBase).length;
    step('baseline pings flow', base >= 5, `${base} pings in 3s, visibility=${lastVis()}`);
    const t0 = lastT0();

    // 2) Element hidden → guest visibilityState must flip to hidden.
    await evaluate(cdp, `(() => {
      const wv = document.querySelector('.canvas-node--iframe webview');
      wv.parentElement.classList.add('iframe-frame-host--frozen');
      return true;
    })()`);
    await sleep(2500);
    const hiddenVis = lastVis();
    const stillPinging = pingsSince(Date.now() - 2000).length > 0;
    step(
      'element hide propagates to guest visibility',
      hiddenVis === 'hidden' && stillPinging,
      `visibility=${hiddenVis} (need hidden), pings still flowing=${stillPinging} — the freeze precondition`,
    );

    // 3) Freeze → guest JS + network stop.
    const frozen = await evaluate(cdp, `window.canvasWorkspace.iframe.setLifecycle(${JSON.stringify(wsId)}, ${JSON.stringify(NODE_ID)}, 'frozen')`);
    step('freeze accepted', !!frozen?.ok, JSON.stringify(frozen));
    await sleep(1000); // in-flight grace
    const tFrozen = Date.now();
    await sleep(5000);
    const duringFreeze = pingsSince(tFrozen).length;
    step('frozen guest is silent', duringFreeze === 0, `${duringFreeze} pings in 5s (need 0)`);

    // 4) Resume → pings return fast, SAME load stamp (zero reload).
    await evaluate(cdp, `(() => {
      const wv = document.querySelector('.canvas-node--iframe webview');
      wv.parentElement.classList.remove('iframe-frame-host--frozen');
      return window.canvasWorkspace.iframe.setLifecycle(${JSON.stringify(wsId)}, ${JSON.stringify(NODE_ID)}, 'active');
    })()`);
    const tResume = Date.now();
    let resumedInMs = -1;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      if (pingsSince(tResume).length > 0) { resumedInMs = Date.now() - tResume; break; }
    }
    step('resume restarts the guest', resumedInMs >= 0, `first ping ${resumedInMs}ms after resume`);
    step('resume did NOT reload', lastT0() === t0, `load stamp ${lastT0() === t0 ? 'unchanged' : `changed ${t0} → ${lastT0()}`}`);

    // 5) Optional L3 discard leg (needs the tiny budget exported before
    //    harness start so main's sweep sees it).
    if (process.env.WEBVIEW_CHECK_DISCARD === '1') {
      await evaluate(cdp, `(() => {
        const wv = document.querySelector('.canvas-node--iframe webview');
        wv.parentElement.classList.add('iframe-frame-host--frozen');
        return window.canvasWorkspace.iframe.setLifecycle(${JSON.stringify(wsId)}, ${JSON.stringify(NODE_ID)}, 'frozen');
      })()`);
      let discarded = false;
      for (let i = 0; i < 100 && !discarded; i++) {
        await sleep(500);
        discarded = await evaluate(cdp, `!!document.querySelector('.iframe-discarded')`);
      }
      const webviewGone = await evaluate(cdp, `!document.querySelector('.canvas-node--iframe webview')`);
      step('L3 discards the over-budget frozen guest', discarded && webviewGone,
        `placeholder=${discarded}, webview element removed=${webviewGone} (sweep interval 30s, waited ≤50s)`);
    } else {
      console.log('SKIP  L3 discard leg (set WEBVIEW_CHECK_DISCARD=1 and export a tiny PULSE_CANVAS_WEBVIEW_MEMORY_BUDGET_MB before harness start)');
    }
  });

  probeServer.close();
  console.log(`\nVERDICT: PASS — ${steps.length} steps green`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
