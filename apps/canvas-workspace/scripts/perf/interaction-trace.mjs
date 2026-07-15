import { promises as fs } from 'node:fs';
import { gzipSync } from 'node:zlib';

const round1 = (value) => Math.round(value * 10) / 10;

export const INTERACTION_TRACE_EVENT_NAMES = [
  'GPUTask',
  'RasterTask',
  'Layerize',
  'Commit',
  'Paint',
  'PrePaint',
  'UpdateLayoutTree',
  'Document::recalcStyle',
  'ProxyMain::BeginMainFrame',
  'WebFrameWidgetImpl::UpdateLifecycle',
];

const emptyMetric = () => ({ count: 0, totalMs: 0, maxMs: 0 });

export const summarizeInteractionTrace = (trace) => {
  const tracked = new Set(INTERACTION_TRACE_EVENT_NAMES);
  const byName = Object.fromEntries(
    INTERACTION_TRACE_EVENT_NAMES.map((name) => [name, emptyMetric()]),
  );
  const events = Array.isArray(trace) ? trace : trace?.traceEvents;

  for (const event of events ?? []) {
    if (event?.ph !== 'X' || !tracked.has(event.name)) continue;
    const durationMs = Number.isFinite(event.dur) ? event.dur / 1_000 : 0;
    const metric = byName[event.name];
    metric.count += 1;
    metric.totalMs += durationMs;
    metric.maxMs = Math.max(metric.maxMs, durationMs);
  }

  for (const metric of Object.values(byName)) {
    metric.totalMs = round1(metric.totalMs);
    metric.maxMs = round1(metric.maxMs);
  }

  return {
    traceEventCount: Array.isArray(events) ? events.length : 0,
    trackedEventCount: Object.values(byName).reduce((sum, metric) => sum + metric.count, 0),
    byName,
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

export const captureInteractionTrace = async (cdp, {
  action,
  rawTracePath,
  relativeTracePath = 'perf/out/panzoom-trace.json.gz',
}) => {
  if (typeof action !== 'function') throw new Error('interaction trace requires an action');
  const browser = await cdp.send('Browser.getVersion').catch(() => ({}));
  let completionPromise;
  let traceStarted = false;
  let completion = null;
  let rawTrace = null;
  let captureError = null;
  let actionResult;

  try {
    completionPromise = cdp.waitForEvent('Tracing.tracingComplete', 60_000);
    await cdp.send('Tracing.start', {
      transferMode: 'ReturnAsStream',
      streamFormat: 'json',
      traceConfig: {
        recordMode: 'recordUntilFull',
        includedCategories: [
          'devtools.timeline',
          'disabled-by-default-devtools.timeline',
          'disabled-by-default-devtools.timeline.frame',
          'blink',
          'cc',
          'gpu',
          'viz',
          'toplevel',
          'input',
        ],
      },
    });
    traceStarted = true;
    actionResult = await action();
  } catch (error) {
    captureError = error;
  } finally {
    if (traceStarted) {
      await cdp.send('Tracing.end', {}, 30_000).catch((error) => {
        captureError ??= error;
      });
      completion = await completionPromise.catch((error) => {
        captureError ??= error;
        return null;
      });
    }
    if (completion?.stream) {
      rawTrace = await readProtocolStream(cdp, completion.stream).catch((error) => {
        captureError ??= error;
        return null;
      });
    }
  }

  if (captureError) throw captureError;
  if (!rawTrace) throw new Error('interaction trace completed without a readable stream');

  let parsed;
  try {
    parsed = JSON.parse(rawTrace.toString('utf-8'));
  } catch (error) {
    throw new Error(`interaction trace returned invalid JSON: ${error.message}`);
  }
  const compressed = gzipSync(rawTrace, { level: 9 });
  await fs.writeFile(rawTracePath, compressed);

  return {
    schemaVersion: 1,
    status: completion.dataLossOccurred ? 'invalid' : 'measured',
    reason: completion.dataLossOccurred ? 'Chrome reported trace buffer data loss' : undefined,
    capture: {
      scope: 'panzoom-interaction',
      browserProduct: browser.product ?? 'unknown',
      protocolVersion: browser.protocolVersion ?? 'unknown',
      dataLossOccurred: !!completion.dataLossOccurred,
    },
    action: actionResult ?? null,
    summary: summarizeInteractionTrace(parsed),
    artifact: {
      path: relativeTracePath,
      format: 'chrome-trace-json+gzip',
      rawBytes: rawTrace.length,
      gzipBytes: compressed.length,
    },
  };
};
