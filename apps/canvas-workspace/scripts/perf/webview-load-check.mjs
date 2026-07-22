#!/usr/bin/env node
/**
 * Deterministic real-Electron check for the initial webview load gate.
 *
 * Start a fresh harness session with the desired concurrency before running:
 *
 *   PULSE_CANVAS_PERF=1 PULSE_CANVAS_WEBVIEW_CONCURRENCY=2 \
 *     pnpm --filter canvas-workspace harness start --profile temp --force
 *   pnpm --filter canvas-workspace perf:webview-load
 *   pnpm --filter canvas-workspace harness close --cleanup
 *
 * `0` is the ungated A/B baseline. The fixture uses six unique local file
 * pages with a bounded CPU-heavy bootstrap, so it exercises real Electron
 * guest creation without network/auth/cache variance. Timing is diagnostic;
 * the hard assertion is the configured admission limit and eventual drain.
 */
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireLiveSession } from '../../harness/tools/driver/src/session.mjs';
import { withPage } from '../../harness/tools/driver/src/cdp.mjs';

const NODE_COUNT = 6;
const WORKSPACE_ID = 'webview-load-probe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const evaluate = async (cdp, expression) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`renderer eval failed: ${result.exceptionDetails.text ?? 'unknown'}`);
  }
  return result.result?.value ?? null;
};

const maximumActive = (events) => {
  const active = new Set();
  let peak = 0;
  for (const event of events) {
    if (event.type === 'granted') active.add(event.id);
    if (event.type === 'released') active.delete(event.id);
    peak = Math.max(peak, active.size);
  }
  return peak;
};

const main = async () => {
  const session = await requireLiveSession();
  if (!session.cleanupHome) {
    throw new Error('webview-load-check requires a disposable temp/clone harness profile');
  }

  const fixtureDir = join(session.home, '.pulse-coder', 'webview-load-fixtures');
  await fs.mkdir(fixtureDir, { recursive: true });
  const urls = [];
  for (let index = 0; index < NODE_COUNT; index++) {
    const file = join(fixtureDir, `page-${index}.html`);
    await fs.writeFile(file, `<!doctype html>
      <meta charset="utf-8"><title>webview load ${index}</title>
      <style>body{font:16px system-ui;padding:32px}main{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}.tile{height:28px;background:hsl(${index * 47} 65% 55%)}</style>
      <body><h1>Webview load probe ${index}</h1><main></main><script>
        const started = performance.now();
        let value = 0;
        while (performance.now() - started < 350) value += Math.sqrt(value + 17) % 11;
        document.querySelector('main').innerHTML = '<div class="tile"></div>'.repeat(96);
        document.body.dataset.ready = String(value);
      </script></body>`, 'utf8');
    urls.push(pathToFileURL(file).href);
  }

  let result;
  await withPage(session, async (cdp) => {
    await evaluate(cdp, `(async () => {
      const store = window.canvasWorkspace.store;
      const urls = ${JSON.stringify(urls)};
      const nodes = urls.map((url, index) => ({
        id: 'webview-load-' + index,
        type: 'iframe',
        title: 'Webview load ' + index,
        // Deliberately overlap by a few pixels: IntersectionObserver v1 is
        // geometry-based, so every host is certainly inside the viewport
        // regardless of the harness window size. The scenario measures guest
        // admission, not canvas layout or human interaction.
        x: 100 + index * 8,
        y: 80 + index * 8,
        width: 480,
        height: 320,
        updatedAt: Date.now(),
        data: { url, mode: 'url', html: '', prompt: '' },
      }));
      await store.save(${JSON.stringify(WORKSPACE_ID)}, {
        nodes,
        edges: [],
        // Keep every host inside the viewport at scale 1. Overview/semantic
        // zoom intentionally hides iframe bodies and would invalidate this
        // initial-load admission check.
        transform: { x: 420, y: 90, scale: 1 },
      });
      const manifest = await store.load('__workspaces__');
      const current = manifest.ok && manifest.data ? manifest.data : { workspaces: [], folders: [] };
      const workspaces = (current.workspaces ?? []).filter((item) => item.id !== ${JSON.stringify(WORKSPACE_ID)});
      workspaces.push({ id: ${JSON.stringify(WORKSPACE_ID)}, name: 'Webview load probe' });
      await store.save('__workspaces__', { ...current, workspaces, activeId: ${JSON.stringify(WORKSPACE_ID)} });
    })()`);
    await evaluate(cdp, 'location.reload()').catch(() => {});
    await cdp.reconnect();

    const deadline = Date.now() + 45_000;
    let probe = null;
    let peakQueuedPlaceholders = 0;
    while (Date.now() < deadline) {
      probe = await evaluate(cdp, `(() => {
        const perf = window.__pulseWebviewInitialLoads;
        if (!perf) return null;
        const prefix = 'canvas:${WORKSPACE_ID}:';
        const events = perf.events.filter((event) => event.id.startsWith(prefix));
        return {
          events,
          snapshot: perf.snapshot(),
          mounted: document.querySelectorAll('.canvas-node--iframe webview').length,
          queuedPlaceholders: document.querySelectorAll('.iframe-load-queued').length,
        };
      })()`).catch(() => null);
      peakQueuedPlaceholders = Math.max(
        peakQueuedPlaceholders,
        probe?.queuedPlaceholders ?? 0,
      );
      const released = probe?.events.filter((event) => event.type === 'released') ?? [];
      if (released.length >= NODE_COUNT) break;
      await sleep(100);
    }
    if (!probe) throw new Error('webview load perf API never became available');

    const events = probe.events;
    const queuedAt = events.find((event) => event.type === 'queued')?.at;
    const releases = events.filter((event) => event.type === 'released');
    const firstReleaseAt = releases[0]?.at;
    const lastReleaseAt = releases[releases.length - 1]?.at;
    const configuredLimit = probe.snapshot.limit;
    const peakActive = maximumActive(events);
    result = {
      concurrency: configuredLimit,
      nodes: NODE_COUNT,
      peakActive,
      firstReadyMs: queuedAt === undefined || firstReleaseAt === undefined ? null : firstReleaseAt - queuedAt,
      allReadyMs: queuedAt === undefined || lastReleaseAt === undefined ? null : lastReleaseAt - queuedAt,
      releaseReasons: releases.map((event) => event.reason),
      mountedAtEnd: probe.mounted,
      peakQueuedPlaceholders,
      queuedPlaceholdersAtEnd: probe.queuedPlaceholders,
      events,
    };

    console.log('[perf:webview-load] probe', JSON.stringify(result));

    if (releases.length !== NODE_COUNT) {
      throw new Error(`only ${releases.length}/${NODE_COUNT} webviews released a load slot`);
    }
    if (configuredLimit > 0 && peakActive > configuredLimit) {
      throw new Error(`peak active ${peakActive} exceeded configured limit ${configuredLimit}`);
    }
    if (
      configuredLimit > 0
      && configuredLimit < NODE_COUNT
      && peakQueuedPlaceholders < NODE_COUNT - configuredLimit
    ) {
      throw new Error(
        `only ${peakQueuedPlaceholders}/${NODE_COUNT - configuredLimit} queued placeholders became visible`,
      );
    }
    if (releases.some((event) => event.reason !== 'complete')) {
      throw new Error(`unexpected release reasons: ${releases.map((event) => event.reason).join(', ')}`);
    }
  });

  const output = join(
    session.artifactsDir,
    `webview-load-${result.concurrency === 0 ? 'unlimited' : result.concurrency}.json`,
  );
  await fs.writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ...result, events: undefined, output }, null, 2));
};

main().catch((error) => {
  console.error('[perf:webview-load]', error);
  process.exitCode = 1;
});
