import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { waitFor } from '../../harness/tools/driver/src/utils.mjs';

const round1 = (value) => Math.round(value * 10) / 10;

export const rateWebVital = (name, value) => {
  if (!Number.isFinite(value)) return 'unavailable';
  if (name === 'lcp') return value <= 2_500 ? 'good' : value <= 4_000 ? 'needs-improvement' : 'poor';
  if (name === 'cls') return value <= 0.1 ? 'good' : value <= 0.25 ? 'needs-improvement' : 'poor';
  return 'unavailable';
};

const WEB_VITALS_BOOTSTRAP = `(() => {
  const state = {
    supported: PerformanceObserver.supportedEntryTypes || [],
    lcp: null,
    shifts: [],
    longTasks: [],
    observers: [],
  };
  Object.defineProperty(window, '__pulseRendererTrace', {
    value: state,
    configurable: true,
  });
  const observe = (type, handle) => {
    try {
      const observer = new PerformanceObserver((list) => handle(list.getEntries()));
      observer.observe({ type, buffered: true });
      state.observers.push(observer);
    } catch {}
  };
  observe('largest-contentful-paint', (entries) => {
    for (const entry of entries) {
      const element = entry.element;
      state.lcp = {
        startTime: entry.startTime,
        size: entry.size || 0,
        url: entry.url || '',
        element: element ? {
          tag: element.tagName,
          id: element.id || '',
          className: typeof element.className === 'string' ? element.className : '',
        } : null,
      };
    }
  });
  observe('layout-shift', (entries) => {
    for (const entry of entries) {
      if (!entry.hadRecentInput) {
        state.shifts.push({ startTime: entry.startTime, value: entry.value });
      }
    }
  });
  observe('longtask', (entries) => {
    for (const entry of entries) {
      state.longTasks.push({ startTime: entry.startTime, duration: entry.duration });
    }
  });
})()`;

const evaluate = async (cdp, expression) => {
  const result = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(`renderer trace eval failed: ${result.exceptionDetails.text ?? 'unknown'}`);
  }
  return result.result?.value ?? null;
};

const cleanupRendererTraceObservers = async (cdp) => {
  await evaluate(cdp, `(() => {
    const state = window.__pulseRendererTrace;
    for (const observer of state?.observers || []) observer.disconnect();
    delete window.__pulseRendererTrace;
    return true;
  })()`).catch(() => false);
};

const hydrateFileResourceSizes = async (entries) => Promise.all((entries ?? []).map(async (entry) => {
  if (Math.max(entry.decodedBodySize ?? 0, entry.encodedBodySize ?? 0, entry.transferSize ?? 0) > 0) {
    return entry;
  }
  try {
    const url = new URL(entry.name);
    if (url.protocol !== 'file:') return entry;
    url.search = '';
    url.hash = '';
    const stat = await fs.stat(fileURLToPath(url));
    return { ...entry, decodedBodySize: stat.size, sizeSource: 'filesystem' };
  } catch {
    return entry;
  }
}));

const metricsMap = (result) => new Map((result?.metrics ?? []).map((entry) => [entry.name, entry.value]));

const durationDeltaMs = (before, after, name) => {
  const end = after.get(name);
  if (!Number.isFinite(end)) return null;
  const startValue = before.get(name);
  const start = Number.isFinite(startValue) ? startValue : 0;
  // Chromium may reset Performance-domain counters on navigation. In that
  // case the post-reload value already represents the new document.
  return round1((end >= start ? end - start : end) * 1000);
};

const countDelta = (before, after, name) => {
  const end = after.get(name);
  if (!Number.isFinite(end)) return null;
  const startValue = before.get(name);
  const start = Number.isFinite(startValue) ? startValue : 0;
  return Math.max(0, Math.round(end >= start ? end - start : end));
};

export const computeCls = (shifts) => {
  const entries = [...(shifts ?? [])]
    .filter((entry) => Number.isFinite(entry.startTime) && Number.isFinite(entry.value))
    .sort((a, b) => a.startTime - b.startTime);
  let max = 0;
  let windowValue = 0;
  let windowStart = 0;
  let previousAt = 0;
  for (const entry of entries) {
    const continues = windowValue > 0
      && entry.startTime - previousAt < 1_000
      && entry.startTime - windowStart <= 5_000;
    if (!continues) {
      windowStart = entry.startTime;
      windowValue = 0;
    }
    windowValue += entry.value;
    previousAt = entry.startTime;
    max = Math.max(max, windowValue);
  }
  return Math.round(max * 10_000) / 10_000;
};

const blockingTimeWithin = (tasks, startAt, endAt) => round1((tasks ?? []).reduce((total, task) => {
  if (!Number.isFinite(task.startTime) || !Number.isFinite(task.duration)) return total;
  const overlapStart = Math.max(task.startTime + 50, startAt);
  const overlapEnd = Math.min(task.startTime + task.duration, endAt);
  return total + Math.max(0, overlapEnd - overlapStart);
}, 0));

const summarizeLoadedResources = (resources, firstCanvasMs, lcpMs) => {
  let documentUrl;
  try {
    documentUrl = new URL(resources?.documentUrl ?? '');
  } catch {
    return {
      loadedToCanvasKB: null,
      loadedToLcpKB: null,
      loadedToCanvasCount: null,
      loadedToLcpCount: null,
    };
  }
  const localEntries = (resources?.entries ?? []).filter((entry) => {
    try {
      const url = new URL(entry.name);
      return url.protocol === 'file:' || url.origin === documentUrl.origin;
    } catch {
      return false;
    }
  });
  const summarizeBefore = (deadline) => {
    if (!Number.isFinite(deadline)) return { kb: null, count: null };
    const loaded = localEntries.filter((entry) => (
      Number.isFinite(entry.responseEnd) && entry.responseEnd <= deadline
    ));
    const bytes = loaded.reduce((total, entry) => total + Math.max(
      Number(entry.decodedBodySize) || 0,
      Number(entry.encodedBodySize) || 0,
      Number(entry.transferSize) || 0,
    ), 0);
    return { kb: round1(bytes / 1024), count: loaded.length };
  };
  const canvas = summarizeBefore(firstCanvasMs);
  const lcp = summarizeBefore(lcpMs);
  return {
    loadedToCanvasKB: canvas.kb,
    loadedToLcpKB: lcp.kb,
    loadedToCanvasCount: canvas.count,
    loadedToLcpCount: lcp.count,
  };
};

export const summarizeRendererReload = ({ vitals, marks, resources, beforeMetrics, afterMetrics }) => {
  const before = metricsMap(beforeMetrics);
  const after = metricsMap(afterMetrics);
  const paint = vitals?.paint ?? {};
  const fcpMs = Number(paint['first-contentful-paint'] ?? 0);
  const firstCanvasMs = Number(marks?.['canvas:first-render'] ?? 0);
  const endAt = firstCanvasMs > fcpMs ? firstCanvasMs : Number(vitals?.settledAt ?? fcpMs);
  const supportsLongTasks = !Array.isArray(vitals?.supported)
    || vitals.supported.includes('longtask');
  const longTasks = supportsLongTasks
    ? [...(vitals?.longTasks ?? [])]
      .filter((task) => Number.isFinite(task.startTime) && Number.isFinite(task.duration))
      .sort((a, b) => b.duration - a.duration)
    : [];
  const lcpStart = vitals?.lcp?.startTime;
  const lcpMs = Number.isFinite(lcpStart) ? round1(lcpStart) : null;
  const supportsCls = !Array.isArray(vitals?.supported) || vitals.supported.includes('layout-shift');
  const layoutShifts = [...(vitals?.shifts ?? [])]
    .filter((entry) => Number.isFinite(entry.startTime) && Number.isFinite(entry.value));
  const cls = supportsCls ? computeCls(layoutShifts) : null;

  return {
    vitals: {
      lcpMs,
      lcpRating: rateWebVital('lcp', lcpMs),
      cls,
      clsRating: rateWebVital('cls', cls),
      layoutShiftCount: supportsCls ? layoutShifts.length : null,
      topLayoutShifts: supportsCls
        ? layoutShifts
          .sort((a, b) => b.value - a.value || a.startTime - b.startTime)
          .slice(0, 5)
          .map((entry) => ({
            startTime: round1(entry.startTime),
            value: Math.round(entry.value * 10_000) / 10_000,
          }))
        : [],
      lcpCandidate: vitals?.lcp ?? null,
    },
    window: {
      fcpMs: round1(fcpMs),
      firstCanvasMs: round1(firstCanvasMs),
      settledAtMs: round1(Number(vitals?.settledAt ?? 0)),
    },
    blocking: {
      timeToCanvasMs: supportsLongTasks && fcpMs > 0 && firstCanvasMs > fcpMs
        ? blockingTimeWithin(longTasks, fcpMs, endAt)
        : null,
      timeCanvasToLcpMs: supportsLongTasks && firstCanvasMs > 0 && lcpMs > firstCanvasMs
        ? blockingTimeWithin(longTasks, firstCanvasMs, lcpMs)
        : null,
      longTaskCount: supportsLongTasks ? longTasks.length : null,
      longTaskTotalMs: supportsLongTasks
        ? round1(longTasks.reduce((sum, task) => sum + task.duration, 0))
        : null,
      longTaskMaxMs: supportsLongTasks ? round1(longTasks[0]?.duration ?? 0) : null,
      top: supportsLongTasks
        ? longTasks.slice(0, 5).map((task) => ({
            startTime: round1(task.startTime),
            duration: round1(task.duration),
          }))
        : [],
    },
    resources: summarizeLoadedResources(resources, firstCanvasMs, lcpMs),
    cpu: {
      taskMs: durationDeltaMs(before, after, 'TaskDuration'),
      scriptMs: durationDeltaMs(before, after, 'ScriptDuration'),
      recalcStyleMs: durationDeltaMs(before, after, 'RecalcStyleDuration'),
      layoutMs: durationDeltaMs(before, after, 'LayoutDuration'),
      layoutCount: countDelta(before, after, 'LayoutCount'),
      recalcStyleCount: countDelta(before, after, 'RecalcStyleCount'),
      domNodes: Number.isFinite(after.get('Nodes')) ? Math.round(after.get('Nodes')) : null,
    },
  };
};

const readProtocolStream = async (cdp, handle) => {
  const chunks = [];
  try {
    while (true) {
      const part = await cdp.send('IO.read', { handle, size: 1024 * 1024 }, 30_000);
      chunks.push(Buffer.from(part.data ?? '', part.base64Encoded ? 'base64' : 'utf-8'));
      if (part.eof) break;
    }
  } finally {
    await cdp.send('IO.close', { handle }).catch(() => {});
  }
  return Buffer.concat(chunks);
};

const waitForRendererReady = (cdp, expectedNodes) => waitFor(async () => {
  const ready = await evaluate(cdp, `(() => ({
    perf: !!window.__pulsePerf,
    canvas: !!document.querySelector('.canvas-container'),
    nodes: document.querySelectorAll('.canvas-node').length,
  }))()`).catch(() => null);
  return ready?.perf && ready?.canvas && ready.nodes >= expectedNodes ? ready : false;
}, 30_000);

export const captureRendererReloadTrace = async (cdp, {
  expectedNodes = 0,
  headless = false,
  rawTracePath,
  relativeTracePath = 'perf/out/renderer-trace.json.gz',
}) => {
  await cdp.send('Page.enable');
  await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
  const browser = await cdp.send('Browser.getVersion').catch(() => ({}));
  const beforeMetrics = await cdp.send('Performance.getMetrics');
  const injected = await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: WEB_VITALS_BOOTSTRAP,
  });
  let traceComplete = null;
  let traceStarted = false;
  let captureError = null;
  let complete = null;
  let rawTrace = null;
  let navigationTimestamp = null;
  const networkRequests = new Map();
  const networkUnsubscribe = [
    cdp.on('Network.requestWillBeSent', (event) => {
      if (event.type === 'Document') navigationTimestamp = event.timestamp;
      networkRequests.set(event.requestId, {
        name: event.request?.url ?? '',
        initiatorType: String(event.type ?? 'other').toLowerCase(),
        startedAt: event.timestamp,
      });
    }),
    cdp.on('Network.responseReceived', (event) => {
      const request = networkRequests.get(event.requestId);
      if (!request) return;
      request.name = event.response?.url ?? request.name;
      request.encodedBodySize = Number(event.response?.encodedDataLength ?? 0);
    }),
    cdp.on('Network.loadingFinished', (event) => {
      const request = networkRequests.get(event.requestId);
      if (!request) return;
      request.finishedAt = event.timestamp;
      request.encodedBodySize = Math.max(
        request.encodedBodySize ?? 0,
        Number(event.encodedDataLength ?? 0),
      );
    }),
  ];

  try {
    await cdp.send('Network.enable');
    await cdp.send('Tracing.start', {
      transferMode: 'ReturnAsStream',
      streamFormat: 'json',
      traceConfig: {
        recordMode: 'recordUntilFull',
        includedCategories: [
          'devtools.timeline',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.frame',
          'blink.user_timing',
          'loading',
          'v8',
          'v8.execute',
        ],
      },
    });
    traceStarted = true;
    traceComplete = cdp.waitForEvent('Tracing.tracingComplete', 60_000);
    await cdp.send('Page.reload', { ignoreCache: true }, 30_000);
    await waitForRendererReady(cdp, expectedNodes);
    await evaluate(cdp, 'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await new Promise((resolveWait) => setTimeout(resolveWait, 750));
  } catch (err) {
    captureError = err;
  } finally {
    if (traceStarted) {
      await cdp.send('Tracing.end', {}, 30_000).catch((err) => {
        captureError ??= err;
      });
      complete = await traceComplete.catch((err) => {
        captureError ??= err;
        return null;
      });
    }
    if (complete?.stream) {
      rawTrace = await readProtocolStream(cdp, complete.stream).catch((err) => {
        captureError ??= err;
        return null;
      });
    }
    if (injected.identifier) {
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: injected.identifier }).catch(() => {});
    }
    for (const unsubscribe of networkUnsubscribe) unsubscribe();
  }

  if (captureError) {
    await cleanupRendererTraceObservers(cdp);
    throw captureError;
  }
  if (!rawTrace) {
    await cleanupRendererTraceObservers(cdp);
    throw new Error('renderer trace completed without a readable stream');
  }

  try {
    const afterMetrics = await cdp.send('Performance.getMetrics');
    const observed = await evaluate(cdp, `(() => {
      const state = window.__pulseRendererTrace || {};
      window.__pulsePerf.begin('_renderer_reload_trace_probe');
      const probe = window.__pulsePerf.end();
      return {
        supported: state.supported || [],
        lcp: state.lcp || null,
        shifts: state.shifts || [],
        longTasks: state.longTasks || [],
        paint: Object.fromEntries(performance.getEntriesByType('paint').map((entry) => [entry.name, entry.startTime])),
        settledAt: performance.now(),
        marks: probe?.marks || {},
        url: location.href,
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
        resources: [
          ...performance.getEntriesByType('navigation'),
          ...performance.getEntriesByType('resource'),
        ].map((entry) => ({
          name: entry.name,
          initiatorType: entry.initiatorType || 'navigation',
          startTime: entry.startTime,
          responseEnd: entry.responseEnd,
          transferSize: entry.transferSize || 0,
          encodedBodySize: entry.encodedBodySize || 0,
          decodedBodySize: entry.decodedBodySize || 0,
        })),
      };
    })()`);
    const networkResources = [...networkRequests.values()]
      .filter((entry) => Number.isFinite(entry.finishedAt) && Number.isFinite(navigationTimestamp))
      .map((entry) => ({
        name: entry.name,
        initiatorType: entry.initiatorType,
        startTime: Math.max(0, (entry.startedAt - navigationTimestamp) * 1000),
        responseEnd: Math.max(0, (entry.finishedAt - navigationTimestamp) * 1000),
        transferSize: entry.encodedBodySize ?? 0,
        encodedBodySize: entry.encodedBodySize ?? 0,
        decodedBodySize: 0,
        sizeSource: 'cdp-network',
      }));
    const resources = await hydrateFileResourceSizes(
      networkResources.length > 1 ? networkResources : observed.resources,
    );
    const summary = summarizeRendererReload({
      vitals: observed,
      marks: observed.marks,
      resources: { documentUrl: observed.url, entries: resources },
      beforeMetrics,
      afterMetrics,
    });
    const compressed = gzipSync(rawTrace, { level: 9 });
    await fs.writeFile(rawTracePath, compressed);

    return {
      schemaVersion: 1,
      status: complete.dataLossOccurred ? 'invalid' : 'measured',
      reason: complete.dataLossOccurred ? 'Chrome reported trace buffer data loss' : undefined,
      capture: {
        scope: 'renderer-reload',
        urlScheme: String(observed.url ?? '').split(':')[0] || 'unknown',
        viewport: observed.viewport,
        browserProduct: browser.product ?? 'unknown',
        userAgent: browser.userAgent ?? 'unknown',
        protocolVersion: browser.protocolVersion ?? 'unknown',
        headless,
        expectedNodes,
        dataLossOccurred: !!complete.dataLossOccurred,
      },
      ...summary,
      diagnostics: {
        supportedEntryTypes: observed.supported,
        resources,
      },
      artifact: {
        path: relativeTracePath,
        format: 'chrome-trace-json+gzip',
        rawBytes: rawTrace.length,
        gzipBytes: compressed.length,
      },
    };
  } finally {
    await cleanupRendererTraceObservers(cdp);
  }
};
