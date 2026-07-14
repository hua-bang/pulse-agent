#!/usr/bin/env node
/**
 * Phase-B runtime scenario benchmarks, driven through the app harness.
 *
 * Prereq: a live harness session (the app already running):
 *   pnpm --filter canvas-workspace build
 *   node harness/tools/driver/cli.mjs start --profile temp   # DISPLAY required (xvfb ok)
 *   pnpm --filter canvas-workspace perf:scenarios [--seed-nodes 86] [--seed-webpages 40] [--seed-url-webviews 25]
 *
 * `--seed-webpages N` (opt-in, default 0): N of the `--seed-nodes` total are
 * seeded as webpage nodes instead of plain `text` nodes. By default they use
 * deterministic `iframe` mode with self-contained HTML. `--seed-url-webviews
 * U` makes U of those M webpages real Electron `<webview>` guests pointed at
 * a random-port 127.0.0.1 fixture server; U must be <= M. The runner waits for
 * exact id/URL/load-state/guest-marker/guest-identity evidence before
 * measuring. Defaults stay 0; exact normalization uses the perf-v2 fixture
 * profile and therefore does not compare with the older perf-v1 history. Use
 * this for one-off comparisons that
 * need a heavier, more representative node-type mix (the tile-memory /
 * pan-zoom regression scales with painted surface area, which text nodes
 * barely exercise).
 *
 * Scenarios (all metrics come from window.__pulsePerf + startup log line):
 *   startup  – main-process phase marks + renderer first-frame/canvas marks + FCP
 *   renderer-trace – warm renderer reload with LCP/CLS, CDP CPU counters,
 *                    and a Chrome trace artifact for diagnostic drill-down
 *   typing   – types into the first file node; guards I-1 via the
 *              nodes-array-replace counter (today: ≈1 replacement per keystroke)
 *   resize   – resizes the first node from its bottom-right corner; records
 *              the same per-pointer-move interaction and frame metrics
 *   drag     – drags the first node by its header; guards A2 via the same
 *              counter (today: ≈1 replacement per pointer-move)
 *
 *   zoom-cold - from a verified idle canvas, dispatches exactly one
 *               ctrl+wheel; keeps the legacy next-rAF response and also
 *               verifies the transform write before crossing one more rAF
 *   webview-lifecycle - diagnostic-only same-guest comparison of geometric
 *                       offscreen sleep against wake + viewport relocation
 *   webview-discard-restore - forces the Chrome-style live guest cap, verifies
 *                             guest destruction, then reloads one page
 *
 * Counter Gates compare against runtime-scoped policies in perf/baselines.json. Timing
 * metrics (INP p95, frame stats) are recorded as informational until enough
 * runs exist to set tolerances. Exit 1 on counter-gate failure.
 *
 * `--repeat N` (A3): typing/resize/drag/zoom-cold/panzoom are re-driven N times against the same live
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
import { getTargets, withPage } from '../../harness/tools/driver/src/cdp.mjs';
import { waitFor } from '../../harness/tools/driver/src/utils.mjs';
import { sampleRetainedHeapMB } from './heap-sampling.mjs';
import { captureInteractionTrace } from './interaction-trace.mjs';
import { captureRendererReloadTrace } from './renderer-trace.mjs';
import { compareCounterGates } from './runtime-gates.mjs';
import { aggregateReports } from './scenario-metrics.mjs';
import { parseScenarioCliArgs } from './scenario-options.mjs';
import { removeScenarioReportArtifact } from './report-artifacts.mjs';
import {
  WEBVIEW_FIXTURE_INSTANCE_TOKEN,
  WEBVIEW_FIXTURE_READY_MARKER,
  startWebviewFixtureServer,
} from './webview-fixture-server.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baselinesPath = join(appRoot, 'perf/baselines.json');
const metricsPath = join(appRoot, 'perf/metrics.json');
const outDir = join(appRoot, 'perf/out');
const rendererTracePath = join(outDir, 'renderer-trace.json.gz');
const rendererTraceSummaryPath = join(outDir, 'renderer-trace-summary.json');
const panzoomTracePath = join(outDir, 'panzoom-trace.json.gz');
const panzoomTraceSummaryPath = join(outDir, 'panzoom-trace-summary.json');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const RUNTIME_FIXTURE_VERSION = 'perf-v2';
const PERF_SEED_NODE_PREFIX = 'perf-seed-';
const TEMP_PROFILE_BASE_WEB_NODE_ID = 'node-welcome-download';
const WEBVIEW_ACTIVITY_WINDOW_MS = 1_000;
const WEBVIEW_VISIBLE_SETTLE_MS = 100;
const WEBVIEW_LIVE_CAP = 16;

export const assertDisposableFixtureSession = (session, seedUrlWebviews) => {
  if (seedUrlWebviews > 0 && session?.profile !== 'temp') {
    throw new Error(
      '--seed-url-webviews requires disposable harness profile=temp; '
      + 'start with `harness start --profile temp` and close with `harness close --cleanup`',
    );
  }
  return true;
};

export const assertWebviewLifecycleFixture = (scenarios, seedUrlWebviews) => {
  if (
    (scenarios.includes('webview-lifecycle') || scenarios.includes('webview-discard-restore'))
    && seedUrlWebviews < 1
  ) {
    throw new Error(
      'webview-lifecycle requires at least one deterministic loopback guest; '
      + 'set --seed-url-webviews >= 1 (the representative command uses 25)',
    );
  }
  if (scenarios.includes('webview-discard-restore') && seedUrlWebviews <= WEBVIEW_LIVE_CAP) {
    throw new Error(
      `webview-discard-restore requires at least ${WEBVIEW_LIVE_CAP + 1} loopback guests `
      + `to exceed the live cap (received ${seedUrlWebviews})`,
    );
  }
  return true;
};

export const selectEvenlySpacedOrdinals = (total, requested) => {
  if (!Number.isInteger(total) || total < 0 || !Number.isInteger(requested) || requested < 0) {
    throw new Error('seed fixture counts must be non-negative integers');
  }
  const count = Math.min(total, requested);
  if (count === 0) return [];
  if (count === 1) return [Math.floor((total - 1) / 2)];
  return Array.from(
    { length: count },
    (_, index) => Math.round(index * (total - 1) / (count - 1)),
  );
};

export const planSeededWebpages = ({
  initialTotal,
  initialWebpages,
  targetTotal,
  targetWebpages,
}) => {
  const plan = planSeededFixture({
    initialTotal,
    initialWebpages,
    initialUrlWebviews: 0,
    targetTotal,
    targetWebpages,
    targetUrlWebviews: 0,
  });
  return {
    ordinals: plan.webpageOrdinals,
    expectedWebpages: plan.expectedWebpages,
  };
};

export const planSeededFixture = ({
  initialTotal,
  initialWebpages,
  initialUrlWebviews,
  targetTotal,
  targetWebpages,
  targetUrlWebviews,
}) => {
  const counts = {
    initialTotal,
    initialWebpages,
    initialUrlWebviews,
    targetTotal,
    targetWebpages,
    targetUrlWebviews,
  };
  for (const [name, value] of Object.entries(counts)) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }
  if (initialWebpages > initialTotal || targetWebpages > targetTotal) {
    throw new Error('seeded webpage counts must be subsets of total node counts');
  }
  if (initialUrlWebviews > initialWebpages || targetUrlWebviews > targetWebpages) {
    throw new Error('seeded URL webview counts must be subsets of webpage counts');
  }
  if (initialTotal > targetTotal) {
    throw new Error(`existing canvas total ${initialTotal} already exceeds target ${targetTotal}`);
  }
  if (initialWebpages > targetWebpages) {
    throw new Error(`existing webpage count ${initialWebpages} exceeds target ${targetWebpages}`);
  }
  if (initialUrlWebviews > targetUrlWebviews) {
    throw new Error(`existing URL webview count ${initialUrlWebviews} exceeds target ${targetUrlWebviews}`);
  }

  const additions = targetTotal - initialTotal;
  const webpagesToAdd = targetWebpages - initialWebpages;
  const urlWebviewsToAdd = targetUrlWebviews - initialUrlWebviews;
  if (webpagesToAdd > additions || urlWebviewsToAdd > webpagesToAdd) {
    throw new Error(
      `requested fixture mix has no remaining node capacity: add ${additions} nodes, `
      + `${webpagesToAdd} webpages, and ${urlWebviewsToAdd} URL webviews`,
    );
  }

  const webpageOrdinals = selectEvenlySpacedOrdinals(additions, webpagesToAdd);
  const urlWebviewOrdinals = selectEvenlySpacedOrdinals(
    webpageOrdinals.length,
    urlWebviewsToAdd,
  ).map((index) => webpageOrdinals[index]);

  return {
    additions,
    webpageOrdinals,
    urlWebviewOrdinals,
    expectedTotal: targetTotal,
    expectedWebpages: targetWebpages,
    expectedUrlWebviews: targetUrlWebviews,
  };
};

const isDisposableFixtureNode = (node) => (
  node?.id === TEMP_PROFILE_BASE_WEB_NODE_ID
  || (typeof node?.id === 'string' && node.id.startsWith(PERF_SEED_NODE_PREFIX))
);
const isWebpageNode = (node) => node?.type === 'iframe';
const isUrlWebviewNode = (node) => isWebpageNode(node) && node?.mode === 'url';
const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));

/**
 * Decide how to normalize only known disposable fixture nodes before adding
 * new perf-seed nodes. Unknown user nodes are immutable: if they make an exact
 * target impossible, the run fails instead of silently rewriting the canvas.
 */
export const planExistingFixtureNormalization = ({
  nodes,
  targetTotal,
  targetWebpages,
  targetUrlWebviews,
}) => {
  if (!Array.isArray(nodes)) throw new Error('existing fixture nodes must be an array');
  for (const [name, value] of Object.entries({
    targetTotal,
    targetWebpages,
    targetUrlWebviews,
  })) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name} must be a non-negative integer`);
    }
  }
  if (targetWebpages > targetTotal || targetUrlWebviews > targetWebpages) {
    throw new Error('target URL webviews must be a subset of target webpages and nodes');
  }
  if (nodes.length > targetTotal) {
    throw new Error(`existing canvas total ${nodes.length} already exceeds target ${targetTotal}`);
  }

  const known = nodes.filter(isDisposableFixtureNode);
  const unknownWebpages = nodes.filter(
    (node) => !isDisposableFixtureNode(node) && isWebpageNode(node),
  );
  if (unknownWebpages.length > targetWebpages) {
    throw new Error(
      `unknown webpage count ${unknownWebpages.length} exceeds target ${targetWebpages}; `
      + 'refusing to rewrite user nodes',
    );
  }
  const unknownUrlWebviews = unknownWebpages.filter(isUrlWebviewNode);
  if (unknownUrlWebviews.length > 0) {
    throw new Error(
      `unknown URL webview nodes cannot be normalized into the deterministic fixture: `
      + unknownUrlWebviews.map((node) => node.id).join(', '),
    );
  }

  const additions = targetTotal - nodes.length;
  const knownPages = known.filter(isWebpageNode);
  const knownNonPages = known.filter((node) => !isWebpageNode(node));
  const currentExistingPages = unknownWebpages.length + knownPages.length;
  const minimumExistingPages = Math.max(unknownWebpages.length, targetWebpages - additions);
  const maximumExistingPages = Math.min(
    targetWebpages,
    unknownWebpages.length + known.length,
  );
  if (minimumExistingPages > maximumExistingPages) {
    throw new Error(
      `requested fixture mix has no safe webpage capacity after preserving `
      + `${unknownWebpages.length} unknown webpage nodes`,
    );
  }
  const normalizedWebpages = clamp(
    currentExistingPages,
    minimumExistingPages,
    maximumExistingPages,
  );
  const normalizedKnownPages = normalizedWebpages - unknownWebpages.length;
  const pageCandidates = [
    ...knownPages.filter(isUrlWebviewNode),
    ...knownPages.filter((node) => !isUrlWebviewNode(node)),
    ...knownNonPages,
  ];
  const selectedPages = pageCandidates.slice(0, normalizedKnownPages);
  const selectedPageIds = new Set(selectedPages.map((node) => node.id));

  const webpagesToAdd = targetWebpages - normalizedWebpages;
  const minimumExistingUrls = Math.max(0, targetUrlWebviews - webpagesToAdd);
  const maximumExistingUrls = Math.min(targetUrlWebviews, normalizedKnownPages);
  if (minimumExistingUrls > maximumExistingUrls) {
    throw new Error(
      `requested fixture mix cannot provide ${targetUrlWebviews} deterministic URL webviews `
      + 'without rewriting unknown user nodes',
    );
  }
  const currentSelectedUrls = selectedPages.filter(isUrlWebviewNode).length;
  const normalizedUrlWebviews = clamp(
    currentSelectedUrls,
    minimumExistingUrls,
    maximumExistingUrls,
  );
  const urlCandidates = [
    ...selectedPages.filter(isUrlWebviewNode),
    ...selectedPages.filter((node) => !isUrlWebviewNode(node)),
  ];
  const selectedUrlIds = new Set(
    urlCandidates.slice(0, normalizedUrlWebviews).map((node) => node.id),
  );

  return {
    specs: known.map((node) => ({
      id: node.id,
      kind: selectedUrlIds.has(node.id)
        ? 'url'
        : selectedPageIds.has(node.id) ? 'html' : 'text',
    })),
    normalizedTotal: nodes.length,
    normalizedWebpages,
    normalizedUrlWebviews,
  };
};

export const assertUrlWebviewReadiness = (expected, observed) => {
  if (observed?.count !== expected.length || observed?.items?.length !== expected.length) {
    throw new Error(
      `URL webview count mismatch: ${observed?.count ?? 0}/${expected.length} real webviews`,
    );
  }
  const webContentsIds = new Set();
  const instanceTokens = new Set();
  for (let index = 0; index < expected.length; index++) {
    const wanted = expected[index];
    const actual = observed.items[index];
    if (actual.id !== wanted.id) {
      throw new Error(`URL webview id mismatch at ${index}: ${actual.id ?? 'missing'}/${wanted.id}`);
    }
    if (actual.url !== wanted.url) {
      throw new Error(`URL webview URL mismatch for ${wanted.id}: ${actual.url ?? 'missing'}/${wanted.url}`);
    }
    if (actual.isLoading !== false) {
      throw new Error(`URL webview ${wanted.id} is still loading or has no load-state evidence`);
    }
    if (actual.marker !== true) {
      throw new Error(`URL webview ${wanted.id} did not expose the readiness marker`);
    }
    if (!Number.isInteger(actual.webContentsId) || actual.webContentsId <= 0) {
      throw new Error(`URL webview ${wanted.id} has no attached WebContents id`);
    }
    if (webContentsIds.has(actual.webContentsId)) {
      throw new Error(`URL webview ${wanted.id} has duplicate WebContents id ${actual.webContentsId}`);
    }
    webContentsIds.add(actual.webContentsId);
    if (typeof actual.instanceToken !== 'string' || actual.instanceToken.trim() === '') {
      throw new Error(`URL webview ${wanted.id} has no document instance token`);
    }
    if (instanceTokens.has(actual.instanceToken)) {
      throw new Error(`URL webview ${wanted.id} has duplicate document instance token`);
    }
    instanceTokens.add(actual.instanceToken);
  }
  return observed.items;
};

export const assertUrlWebviewStatePreserved = (before, after) => {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
    throw new Error(`URL webview continuity count mismatch: ${before?.length ?? 0}/${after?.length ?? 0}`);
  }
  const afterById = new Map(after.map((item) => [item.id, item]));
  for (const initial of before) {
    const current = afterById.get(initial.id);
    if (!current || current.url !== initial.url || current.marker !== true || current.isLoading !== false) {
      throw new Error(`URL webview ${initial.id} lost readiness continuity after interactions`);
    }
    if (current.webContentsId !== initial.webContentsId) {
      throw new Error(
        `URL webview ${initial.id} WebContents changed after interactions: `
        + `${initial.webContentsId}/${current.webContentsId ?? 'missing'}`,
      );
    }
    if (current.instanceToken !== initial.instanceToken) {
      throw new Error(
        `URL webview ${initial.id} document instance changed after interactions: `
        + `${initial.instanceToken}/${current.instanceToken ?? 'missing'}`,
      );
    }
  }
  return true;
};

export const createScenarioFixtureMetadata = ({
  seedNodes,
  seedWebpages,
  seedUrlWebviews,
  sessionProfile = null,
  seeded = null,
}) => ({
  schemaVersion: RUNTIME_FIXTURE_VERSION,
  sessionProfile,
  requested: {
    nodes: seedNodes,
    webpages: seedWebpages,
    urlWebviews: seedUrlWebviews,
  },
  observed: seeded ? {
    nodes: seeded.total,
    webpages: seeded.webpages,
    urlWebviews: seeded.urlWebviews,
    liveUrlWebviews: seeded.webviews?.length ?? 0,
  } : null,
  readinessMarker: seedUrlWebviews > 0 ? WEBVIEW_FIXTURE_READY_MARKER : null,
  webviews: seeded?.webviews ?? [],
  statePreserved: seeded?.statePreserved ?? null,
  stateCheckedAfterScenarios: seeded?.stateCheckedAfterScenarios ?? [],
  webviewsAfterInteractions: seeded?.webviewsAfterInteractions ?? [],
});

const STATE_PRESERVATION_INTERACTIONS = [
  'typing',
  'resize',
  'drag',
  'zoom-cold',
  'panzoom',
  'panzoom-trace',
  'zoom-settle',
  'webview-lifecycle',
];
const STATE_PRESERVATION_TRIGGERS = new Set([
  'zoom-cold',
  'panzoom',
  'panzoom-trace',
  'zoom-settle',
  'webview-lifecycle',
]);

export const selectStatePreservationScenarios = (executedScenarios) => {
  const executed = new Set(executedScenarios);
  if (executed.has('webview-discard-restore')) return [];
  const interactions = STATE_PRESERVATION_INTERACTIONS.filter((name) => executed.has(name));
  return interactions.some((name) => STATE_PRESERVATION_TRIGGERS.has(name))
    ? interactions
    : [];
};

export const isRenderedFixtureReady = (rendered, plan) => (
  rendered?.perfReady === true
  // The persisted store assertion is the exact N/M/U composition SSOT. DOM
  // `.canvas-node` is only a mount-readiness floor because every Frame renders
  // both a body node and a title-overlay node.
  && rendered.total >= plan.expectedTotal
  && rendered.webpages === plan.expectedWebpages
  && (plan.expectedUrlWebviews > 0 || rendered.urlWebviews === 0)
);

export const coldZoomDeltaForScale = (scale) => {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('cold zoom scale must be positive');
  // Move toward scale=1 so a single sample cannot disappear into either
  // useCanvas clamp (0.1-4) after a previous repeat changed the viewport.
  return scale < 1 ? -20 : 20;
};

export const validateColdZoomRun = ({
  restBefore,
  wheelToNextFrame,
  wheelToPresentedFrame,
  transformBefore,
  transformAfter,
}) => {
  if (!restBefore || restBefore.canvasMoving || restBefore.transformMoving) {
    throw new Error('zoom-cold did not begin from a verified idle canvas');
  }
  if (wheelToNextFrame?.count !== 1 || !Number.isFinite(wheelToNextFrame.p95)) {
    throw new Error(`zoom-cold expected exactly one measured wheel, got ${wheelToNextFrame?.count ?? 0}`);
  }
  if (
    wheelToPresentedFrame?.count !== 1
    || !wheelToPresentedFrame.transformChanged
    || !Number.isFinite(wheelToPresentedFrame.transformObservedP95)
    || !Number.isFinite(wheelToPresentedFrame.p95)
    || wheelToPresentedFrame.framesUntilTransform < 1
    || wheelToPresentedFrame.framesAfterTransform < 1
  ) {
    throw new Error('zoom-cold presented-frame probe lacks transform and post-transform frame evidence');
  }
  if (wheelToPresentedFrame.p95 < wheelToPresentedFrame.transformObservedP95) {
    throw new Error('zoom-cold presented-frame latency ended before the transform observation');
  }
  if (wheelToPresentedFrame.p95 < wheelToNextFrame.p95) {
    throw new Error('zoom-cold presented-frame latency ended before the legacy next-frame probe');
  }
  if (!transformBefore || !transformAfter || transformBefore === transformAfter) {
    throw new Error(`zoom-cold gesture did not change .canvas-transform (${transformBefore ?? 'missing'})`);
  }
  return { coldStartVerified: true, transformChanged: true };
};
// Covers the editor's 200ms writeback debounce plus useNodes' 800ms save
// debounce, with margin for a busy renderer. Counter windows must start with
// no prior save pending and end only after the measured gesture's save fires.
const SAVE_DRAIN_MS = 1_200;
const drainCanvasSave = () => sleep(SAVE_DRAIN_MS);

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
export const BLANK_CANVAS_BLOCKED_SELECTOR = [
  '.canvas-node',
  '.canvas-empty-hint',
  '.canvas-fullscreen-chip',
  '.canvas-bottom-chrome',
  '.floating-toolbar',
  '.zoom-indicator',
  '.context-menu',
  '.canvas-edges',
  '.canvas-connect-overlay',
  '.canvas-shape-overlay',
  '.canvas-interaction-shield',
  '.edge-style-panel',
  '.sidebar',
].join(', ');

const findBlankCanvasPoint = async (cdp) => {
  // A fit-to-view layout (e.g. after seedExtraNodes reloads) can zoom out
  // far enough that a handful of fixed corner guesses all land on some
  // node — dense grids leave only thin, unpredictable gaps. Scan a real
  // grid across the viewport (in-page, one round trip) instead of guessing
  // a few fixed points.
  const point = await evaluate(cdp, `(() => {
    const canvas = document.querySelector('.canvas-container');
    if (!canvas) throw new Error('canvas container missing while finding a blank point');
    const blockedSel = ${JSON.stringify(BLANK_CANVAS_BLOCKED_SELECTOR)};
    for (let fy = 0.1; fy <= 0.9; fy += 0.08) {
      for (let fx = 0.1; fx <= 0.9; fx += 0.06) {
        const x = Math.round(innerWidth * fx);
        const y = Math.round(innerHeight * fy);
        const el = document.elementFromPoint(x, y);
        if (el && canvas.contains(el) && !el.closest(blockedSel)) {
          const ancestry = [];
          for (let node = el; node && ancestry.length < 6; node = node.parentElement) {
            ancestry.push(node.tagName.toLowerCase() + (node.className
              ? '.' + String(node.className).trim().replace(/\s+/g, '.')
              : ''));
            if (node === canvas) break;
          }
          return { x, y, ancestry };
        }
      }
    }
    return null;
  })()`);
  if (!point) throw new Error('no blank canvas point found across a full viewport grid scan');
  return point;
};

/** Wait until the renderer main thread stops long-stalling (two calm rAF probes). */
export const waitForCalmFrames = async (cdp, timeoutMs = 30_000) => {
  const started = Date.now();
  let lastDelta = null;
  while (Date.now() - started < timeoutMs) {
    lastDelta = await evaluate(cdp, `new Promise((done) => {
      requestAnimationFrame((a) => requestAnimationFrame((b) => done(b - a)));
    })`).catch(() => 1_000);
    if (Number.isFinite(lastDelta) && lastDelta < 40) return;
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining > 0) await sleep(Math.min(250, remaining));
  }
  throw new Error(
    `renderer did not reach calm frames within ${timeoutMs}ms; `
    + `last delta ${Number.isFinite(lastDelta) ? lastDelta : 'unavailable'}ms`,
  );
};

// The chat scenario opens the in-flow right dock, which halves the canvas in
// the 1200px harness viewport. Leaving it open makes a later +270px drag move
// its target under the dock; the reset can then grab a different node and turn
// a repeat into a false no-op. Close it outside the measured window and wait
// past the dock's 260ms CSS transition before any canvas scenario picks a
// coordinate.
const CHAT_DOCK_SETTLE_MS = 320;
export const closeActiveChatDock = async (cdp) => {
  const toggled = await evaluate(cdp, `(() => {
    const toggle = document.querySelector('.chat-floating-button--active');
    if (!(toggle instanceof HTMLElement)) return false;
    toggle.click();
    return true;
  })()`);
  if (!toggled) return false;

  await sleep(CHAT_DOCK_SETTLE_MS);
  const closed = await evaluate(cdp, `(() => (
    !document.querySelector('.chat-floating-button--active')
    && document.querySelector('.right-dock')?.getAttribute('data-expanded') !== 'true'
  ))()`);
  if (!closed) throw new Error('chat dock did not collapse after chat-stream scenario');
  await waitForCalmFrames(cdp, 5_000);
  return true;
};

const clickAt = async (cdp, x, y, clickCount = 1) => {
  await mouse(cdp, 'mousePressed', x, y, { button: 'left', buttons: 1, clickCount });
  await mouse(cdp, 'mouseReleased', x, y, { button: 'left', buttons: 0, clickCount });
};

const beginPerf = (cdp, name) => evaluate(cdp, `window.__pulsePerf.begin(${JSON.stringify(name)})`);
const endPerf = (cdp) => evaluate(cdp, `JSON.stringify(window.__pulsePerf.end())`).then(JSON.parse);

// The active gesture window deliberately excludes save debounce/drain time.
// Waiting two frames first lets React/DOM work triggered by the final input
// land inside the active sample without counting unrelated idle frames.
const markActiveEnd = (cdp) => evaluate(cdp, `new Promise((done) => {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    window.__pulsePerf.markActiveEnd();
    done(true);
  }));
})`);

const installWheelToNextFrameProbe = (cdp) => evaluate(cdp, `(() => {
  const previous = window.__pulseWheelToNextFrameProbe;
  if (previous?.handler) window.removeEventListener('wheel', previous.handler, true);
  const samples = [];
  const handler = () => {
    const startedAt = performance.now();
    // Chromium's rAF timestamp represents the start of the rendering frame;
    // an input callback can run later in that same frame, making
    // rafTimestamp - performance.now() slightly negative. Read the clock
    // inside the callback so the latency is monotonic and never fabricated.
    requestAnimationFrame(() => samples.push(performance.now() - startedAt));
  };
  window.addEventListener('wheel', handler, { capture: true, passive: true });
  window.__pulseWheelToNextFrameProbe = { handler, samples };
  return true;
})()`);

const finishWheelToNextFrameProbe = (cdp) => evaluate(cdp, `(() => {
  const probe = window.__pulseWheelToNextFrameProbe;
  if (!probe) throw new Error('wheel-to-next-frame probe missing');
  window.removeEventListener('wheel', probe.handler, true);
  delete window.__pulseWheelToNextFrameProbe;
  const samples = [...probe.samples].sort((a, b) => a - b);
  const round1 = (value) => Math.round(value * 10) / 10;
  const p95Index = Math.max(0, Math.ceil(samples.length * 0.95) - 1);
  return {
    count: samples.length,
    p95: samples.length ? round1(samples[p95Index]) : null,
    max: samples.length ? round1(samples[samples.length - 1]) : null,
  };
})()`);

// The legacy capture-phase probe above queues its rAF before React's bubble
// handler queues useCanvas' transform rAF. Keep it for historical continuity,
// but zoom-cold also installs this stricter probe. Its microtask runs after
// event propagation, so the first observation rAF is queued behind the app's
// transform write. Once that write is visible, one additional rAF crosses the
// next rendering opportunity. This is a browser presented-frame boundary
// proxy, not a GPU SwapBuffers timestamp.
const installWheelToPresentedFrameProbe = (cdp, expectedTransform) => evaluate(cdp, `(() => {
  const previous = window.__pulseWheelToPresentedFrameProbe;
  if (previous?.handler) {
    previous.completed = true;
    window.removeEventListener('wheel', previous.handler, true);
  }

  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const probe = {
    completed: false,
    eventCount: 0,
    expectedTransform: ${JSON.stringify(expectedTransform)},
    handler: null,
    done,
  };
  const complete = (result) => {
    if (probe.completed) return;
    probe.completed = true;
    resolveDone(result);
  };
  const fail = (error) => complete({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });

  const handler = () => {
    probe.eventCount += 1;
    const startedAt = performance.now();
    if (probe.eventCount !== 1) {
      fail('presented-frame probe observed more than one wheel');
      return;
    }

    try {
      const transform = document.querySelector('.canvas-transform');
      if (!transform) throw new Error('canvas transform element missing at wheel capture');
      const transformBefore = getComputedStyle(transform).transform;
      if (transformBefore !== probe.expectedTransform) {
        throw new Error('canvas transform drifted before the measured wheel');
      }

      // Let the wheel event finish propagating through React before queuing
      // our observation rAF. useCanvas queues its transform rAF in that bubble
      // handler, so it must run before this observer in the same frame.
      queueMicrotask(() => {
        let framesUntilTransform = 0;
        const observeTransform = () => {
          if (probe.completed) return;
          try {
            framesUntilTransform += 1;
            const current = getComputedStyle(transform).transform;
            if (current === transformBefore) {
              if (framesUntilTransform >= 8) {
                fail('canvas transform did not update within 8 animation frames');
                return;
              }
              requestAnimationFrame(observeTransform);
              return;
            }

            const transformObservedMs = performance.now() - startedAt;
            requestAnimationFrame(() => {
              try {
                const presentedTransform = getComputedStyle(transform).transform;
                if (presentedTransform === transformBefore) {
                  throw new Error('canvas transform reverted before the presented-frame boundary');
                }
                const round1 = (value) => Math.round(value * 10) / 10;
                const presentedFrameMs = round1(performance.now() - startedAt);
                complete({
                  ok: true,
                  count: probe.eventCount,
                  p95: presentedFrameMs,
                  max: presentedFrameMs,
                  transformObservedP95: round1(transformObservedMs),
                  transformChanged: true,
                  framesUntilTransform,
                  framesAfterTransform: 1,
                });
              } catch (error) {
                fail(error);
              }
            });
          } catch (error) {
            fail(error);
          }
        };
        requestAnimationFrame(observeTransform);
      });
    } catch (error) {
      fail(error);
    }
  };

  probe.handler = handler;
  window.addEventListener('wheel', handler, { capture: true, passive: true });
  window.__pulseWheelToPresentedFrameProbe = probe;
  return true;
})()`);

const finishWheelToPresentedFrameProbe = (cdp) => evaluate(cdp, `(async () => {
  const probe = window.__pulseWheelToPresentedFrameProbe;
  if (!probe) throw new Error('wheel-to-presented-frame probe missing');
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({
      ok: false,
      error: 'wheel-to-presented-frame probe timed out',
    }), 2_000);
  });
  const result = await Promise.race([probe.done, timeout]);
  clearTimeout(timeoutId);
  probe.completed = true;
  window.removeEventListener('wheel', probe.handler, true);
  delete window.__pulseWheelToPresentedFrameProbe;
  if (!result.ok) throw new Error(result.error);
  return result;
})()`);

const readColdZoomState = (cdp) => evaluate(cdp, `(() => {
  const root = document.querySelector('.canvas-container');
  const transform = document.querySelector('.canvas-transform');
  if (!root || !transform) throw new Error('cold zoom canvas surface missing');
  const computedTransform = getComputedStyle(transform).transform;
  const matrix = new DOMMatrixReadOnly(computedTransform);
  return {
    transform: computedTransform,
    scale: Math.hypot(matrix.a, matrix.b),
    canvasMoving: root.getAttribute('data-moving') === 'on',
    transformMoving: transform.classList.contains('canvas-transform--moving'),
    fullscreen: root.getAttribute('data-fullscreen'),
  };
})()`);

const waitForColdZoomRest = async (cdp) => {
  const readRest = async () => {
    const state = await readColdZoomState(cdp).catch(() => null);
    return state && !state.canvasMoving && !state.transformMoving ? state : false;
  };
  await waitFor(readRest, 30_000);
  // The moving flags can clear in the React commit immediately before paint.
  // A calm double-rAF plus a second state check makes "cold" a measured
  // precondition instead of an assumption based on a timer duration.
  await waitForCalmFrames(cdp);
  return waitFor(readRest, 5_000);
};

const installZoomSettleProbe = (cdp) => evaluate(cdp, `(() => {
  const previous = window.__pulseZoomSettleProbe;
  previous?.cleanup?.();
  const root = document.querySelector('.canvas-container');
  const transform = document.querySelector('.canvas-transform');
  if (!root || !transform) throw new Error('zoom-settle canvas surface missing');
  let lastWheelAt = null;
  let lastWheelTarget = null;
  let canvasWheelCount = 0;
  let sawMoving = false;
  let settled = false;
  let resolveDone;
  const done = new Promise((resolve) => { resolveDone = resolve; });
  const isMoving = () => (
    root.getAttribute('data-moving') === 'on'
    || transform.classList.contains('canvas-transform--moving')
  );
  const cleanup = () => {
    observer.disconnect();
    clearInterval(pollId);
    window.removeEventListener('wheel', onWheel, true);
    root.removeEventListener('wheel', onCanvasWheel);
  };
  const finish = () => {
    if (settled || lastWheelAt === null || !sawMoving || isMoving()) return;
    settled = true;
    // CanvasSurface glides --canvas-scale for 140ms after MOVING_IDLE_MS.
    // Include that compositor/style settle instead of ending at the React
    // moving-flag commit, then cross two presented-frame opportunities.
    setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      const endedAt = performance.now();
      cleanup();
      resolveDone({
        lastWheelToRestMs: Math.round((endedAt - lastWheelAt) * 10) / 10,
        settleDelayMs: 160,
        sawMoving,
        canvasMoving: root.getAttribute('data-moving') === 'on',
        transformMoving: transform.classList.contains('canvas-transform--moving'),
      });
    })), 160);
  };
  const observer = new MutationObserver(() => {
    if (isMoving()) sawMoving = true;
    finish();
  });
  // MutationObserver records may be coalesced when React enters and leaves
  // moving state between delivery checkpoints. Polling the same two public
  // DOM signals keeps the diagnostic fail-closed without making a mutation
  // callback the only way the promise can settle.
  const pollId = setInterval(() => {
    if (isMoving()) sawMoving = true;
    finish();
  }, 16);
  const onWheel = (event) => {
    if (!event.ctrlKey) return;
    lastWheelAt = performance.now();
    lastWheelTarget = event.target instanceof Element
      ? event.target.tagName.toLowerCase() + '.' + event.target.className
      : String(event.target);
  };
  const onCanvasWheel = (event) => {
    if (event.ctrlKey) canvasWheelCount += 1;
  };
  observer.observe(root, { attributes: true, attributeFilter: ['data-moving'] });
  observer.observe(transform, { attributes: true, attributeFilter: ['class'] });
  window.addEventListener('wheel', onWheel, { capture: true, passive: true });
  root.addEventListener('wheel', onCanvasWheel);
  const debug = () => ({
    lastWheelAt,
    lastWheelTarget,
    canvasWheelCount,
    sawMoving,
    settled,
    canvasMoving: root.getAttribute('data-moving') === 'on',
    transformMoving: transform.classList.contains('canvas-transform--moving'),
    fullscreen: root.getAttribute('data-fullscreen'),
  });
  window.__pulseZoomSettleProbe = { done, cleanup, debug };
  return true;
})()`);

const finishZoomSettleProbe = (cdp) => evaluate(cdp, `(async () => {
  const probe = window.__pulseZoomSettleProbe;
  if (!probe) throw new Error('zoom-settle probe missing');
  let timeoutId;
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve({ error: 'zoom-settle probe timed out' }), 5_000);
  });
  const result = await Promise.race([probe.done, timeout]);
  clearTimeout(timeoutId);
  probe.cleanup();
  delete window.__pulseZoomSettleProbe;
  if (result.error) {
    throw new Error(result.error + ': ' + JSON.stringify(probe.debug?.() ?? {}));
  }
  return result;
})()`);

const medianNumber = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) * 5) / 10;
};

const readPanzoomSurface = (cdp) => evaluate(cdp, `(() => {
  const transform = document.querySelector('.canvas-transform');
  const matrix = transform ? new DOMMatrixReadOnly(getComputedStyle(transform).transform) : null;
  const hosts = [...document.querySelectorAll('.iframe-frame-host')]
    .filter((host) => host.querySelector('webview'));
  const intersectsViewport = (host) => {
    const rect = host.getBoundingClientRect();
    return rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight;
  };
  return {
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
    scale: matrix ? Math.round(Math.hypot(matrix.a, matrix.b) * 1e6) / 1e6 : null,
    webviewHosts: hosts.length,
    geometricallyOffscreenWebviews: hosts.filter((host) => !intersectsViewport(host)).length,
    cssHiddenWebviews: hosts.filter((host) => getComputedStyle(host).visibility === 'hidden').length,
    intersectingViewportWebviews: hosts.filter(intersectsViewport).length,
  };
})()`);

const WEBVIEW_ACTIVITY_PROBE_KEY = '__pulsePerfWebviewActivityProbe';
const WEBVIEW_ACTIVITY_STATE_ATTRIBUTE = 'data-pulse-perf-webview-activity-state';

const installWebviewActivityProbeSource = `(() => {
  const probeKey = ${JSON.stringify(WEBVIEW_ACTIVITY_PROBE_KEY)};
  const stateAttribute = ${JSON.stringify(WEBVIEW_ACTIVITY_STATE_ATTRIBUTE)};
  const previous = window[probeKey];
  if (previous && typeof previous.cleanup === 'function') previous.cleanup();
  document.querySelector('input[' + stateAttribute + ']')?.remove();

  const instanceToken = window[${JSON.stringify(WEBVIEW_FIXTURE_INSTANCE_TOKEN)}] ?? null;
  if (typeof instanceToken !== 'string' || instanceToken.length === 0) {
    throw new Error('fixture document instance token is unavailable');
  }
  const stateInput = document.createElement('input');
  stateInput.type = 'text';
  stateInput.hidden = true;
  stateInput.setAttribute(stateAttribute, 'true');
  stateInput.value = 'webview-lifecycle-state:' + instanceToken;
  document.body.appendChild(stateInput);

  const probe = {
    rafCount: 0,
    intervalCount: 0,
    rafId: 0,
    intervalId: 0,
    startedAt: performance.now(),
    stopped: false,
    stateToken: stateInput.value,
    cleanup: null,
  };
  const onAnimationFrame = () => {
    if (probe.stopped) return;
    probe.rafCount += 1;
    probe.rafId = requestAnimationFrame(onAnimationFrame);
  };
  probe.cleanup = () => {
    if (probe.stopped) return;
    probe.stopped = true;
    cancelAnimationFrame(probe.rafId);
    clearInterval(probe.intervalId);
  };
  probe.rafId = requestAnimationFrame(onAnimationFrame);
  probe.intervalId = setInterval(() => { probe.intervalCount += 1; }, 10);
  window[probeKey] = probe;
  return {
    installed: true,
    marker: window[${JSON.stringify(WEBVIEW_FIXTURE_READY_MARKER)}] === true,
    instanceToken,
    stateToken: probe.stateToken,
  };
})()`;

const sampleWebviewActivityProbeSource = `(() => {
  const probe = window[${JSON.stringify(WEBVIEW_ACTIVITY_PROBE_KEY)}];
  const stateInput = document.querySelector(
    'input[' + ${JSON.stringify(WEBVIEW_ACTIVITY_STATE_ATTRIBUTE)} + ']',
  );
  if (!probe || probe.stopped || !stateInput) {
    throw new Error('guest activity probe is not installed');
  }
  return {
    raf: probe.rafCount,
    interval: probe.intervalCount,
    elapsedMs: Math.round((performance.now() - probe.startedAt) * 10) / 10,
    marker: window[${JSON.stringify(WEBVIEW_FIXTURE_READY_MARKER)}] === true,
    instanceToken: window[${JSON.stringify(WEBVIEW_FIXTURE_INSTANCE_TOKEN)}] ?? null,
    stateToken: stateInput.value,
    documentVisibility: document.visibilityState,
  };
})()`;

const cleanupWebviewActivityProbeSource = `(() => {
  const probeKey = ${JSON.stringify(WEBVIEW_ACTIVITY_PROBE_KEY)};
  const probe = window[probeKey];
  if (!probe || typeof probe.cleanup !== 'function') {
    return { cleaned: false, reason: 'guest activity probe is missing' };
  }
  probe.cleanup();
  document.querySelector(
    'input[' + ${JSON.stringify(WEBVIEW_ACTIVITY_STATE_ATTRIBUTE)} + ']',
  )?.remove();
  delete window[probeKey];
  return {
    cleaned: window[probeKey] === undefined
      && document.querySelector(
        'input[' + ${JSON.stringify(WEBVIEW_ACTIVITY_STATE_ATTRIBUTE)} + ']',
      ) === null,
  };
})()`;

const readWebviewActivitySurface = (cdp, expected) => evaluate(cdp, `(() => {
  const expected = ${JSON.stringify(expected)};
  const all = [...document.querySelectorAll('.canvas-node--iframe webview')];
  const urlOf = (webview) => {
    try {
      return webview.getURL?.() || webview.getAttribute('src') || '';
    } catch {
      return webview.getAttribute('src') || '';
    }
  };
  const items = expected.map((wanted) => {
    const webview = all.find((candidate) => urlOf(candidate) === wanted.url);
    if (!webview) return { ...wanted, mounted: false };
    const host = webview.closest('.iframe-frame-host');
    let webContentsId = null;
    try { webContentsId = webview.getWebContentsId(); } catch { /* readiness reports this later */ }
    const rect = host?.getBoundingClientRect();
    const visibility = host ? getComputedStyle(host).visibility : null;
    return {
      ...wanted,
      mounted: true,
      webContentsId,
      visibility,
      intersectsViewport: !!rect
        && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight,
    };
  });
  const mounted = items.filter((item) => item.mounted);
  return {
    total: mounted.length,
    expected: expected.length,
    offscreen: mounted.filter((item) => !item.intersectsViewport).length,
    cssHidden: mounted.filter((item) => item.visibility === 'hidden').length,
    intersecting: mounted.filter((item) => item.intersectsViewport).length,
    items,
  };
})()`);

const runWebviewGuestScript = async (cdp, target, operation, source) => {
  const result = await evaluate(cdp, `(async () => {
    const expectedUrl = ${JSON.stringify(target.url)};
    const all = [...document.querySelectorAll('.canvas-node--iframe webview')];
    const urlOf = (webview) => {
      try {
        return webview.getURL?.() || webview.getAttribute('src') || '';
      } catch {
        return webview.getAttribute('src') || '';
      }
    };
    const webview = all.find((candidate) => urlOf(candidate) === expectedUrl);
    if (!webview) return { ok: false, reason: 'target loopback WebView is not mounted' };
    if (typeof webview.executeJavaScript !== 'function') {
      return { ok: false, reason: 'WebView executeJavaScript is unsupported' };
    }
    const host = webview.closest('.iframe-frame-host');
    if (!host) return { ok: false, reason: 'target WebView host is missing' };
    let webContentsId = null;
    try { webContentsId = webview.getWebContentsId(); } catch { /* reported below */ }
    try {
      const value = await webview.executeJavaScript(${JSON.stringify(source)}, true);
      return {
        ok: true,
        url: urlOf(webview),
        webContentsId,
        visibility: getComputedStyle(host).visibility,
        value,
      };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  })()`);
  if (result?.ok !== true) {
    throw new Error(`webview-lifecycle ${operation} unavailable: ${result?.reason ?? 'no guest result'}`);
  }
  return result;
};

const activityDelta = (before, after, phase) => {
  for (const [name, value] of Object.entries({
    beforeRaf: before?.raf,
    afterRaf: after?.raf,
    beforeInterval: before?.interval,
    afterInterval: after?.interval,
    beforeElapsedMs: before?.elapsedMs,
    afterElapsedMs: after?.elapsedMs,
  })) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`webview-lifecycle ${phase} has no finite ${name} sample`);
    }
  }
  const raf = after.raf - before.raf;
  const interval = after.interval - before.interval;
  const elapsedMs = Math.round((after.elapsedMs - before.elapsedMs) * 10) / 10;
  if (raf < 0 || interval < 0 || elapsedMs <= 0) {
    throw new Error(`webview-lifecycle ${phase} activity counters are not monotonic`);
  }
  return { raf, interval, elapsedMs };
};

export const validateWebviewLifecycleMeasurement = ({
  expectedGuests,
  surfaceBefore,
  surfaceAfterOffscreen,
  surfaceVisible,
  surfaceRestored,
  baseline,
  installed,
  offscreenStart,
  offscreenEnd,
  visibleStart,
  visibleEnd,
  cleanup,
  relocation,
  restore,
  measurementWindowMs = WEBVIEW_ACTIVITY_WINDOW_MS,
}) => {
  if (!Number.isInteger(expectedGuests) || expectedGuests < 1) {
    throw new Error('webview-lifecycle requires a non-empty guest sample');
  }
  for (const [phase, surface] of Object.entries({
    before: surfaceBefore,
    afterOffscreen: surfaceAfterOffscreen,
    visible: surfaceVisible,
    restored: surfaceRestored,
  })) {
    if (surface?.total !== expectedGuests || surface.items?.length !== expectedGuests) {
      throw new Error(
        `webview-lifecycle ${phase} guest sample mismatch: `
        + `${surface?.total ?? 0}/${expectedGuests} mounted`,
      );
    }
  }
  if (surfaceBefore.offscreen < 1) {
    throw new Error(
      `webview-lifecycle has no geometrically offscreen guest sample: `
      + `${surfaceBefore.offscreen}/${expectedGuests} offscreen`,
    );
  }
  if (surfaceBefore.offscreen + surfaceBefore.intersecting !== expectedGuests) {
    throw new Error('webview-lifecycle offscreen/intersecting guest counts do not cover the fixture');
  }

  const targetAt = (surface) => surface.items.find((item) => item.url === baseline.url);
  const beforeTarget = targetAt(surfaceBefore);
  const afterOffscreenTarget = targetAt(surfaceAfterOffscreen);
  const visibleTarget = targetAt(surfaceVisible);
  const restoredTarget = targetAt(surfaceRestored);
  if (
    beforeTarget?.visibility === 'hidden' || beforeTarget?.intersectsViewport !== false
    || afterOffscreenTarget?.visibility === 'hidden'
    || afterOffscreenTarget?.intersectsViewport !== false
  ) {
    throw new Error('webview-lifecycle target did not remain geometrically offscreen');
  }
  if (
    visibleTarget?.visibility === 'hidden'
    || visibleTarget?.intersectsViewport !== true
  ) {
    throw new Error('webview-lifecycle target did not enter the relocated visible window');
  }
  if (
    restoredTarget?.visibility === 'hidden'
    || restoredTarget?.intersectsViewport !== false
  ) {
    throw new Error('webview-lifecycle target did not return offscreen after geometry restore');
  }
  if (
    relocation?.ok !== true
    || restore?.ok !== true
    || restore.translateRestored !== true
    || restore.zIndexRestored !== true
    || restore.intersectsViewport !== false
  ) {
    throw new Error('webview-lifecycle has no proof that temporary geometry was restored');
  }

  const envelopes = [installed, offscreenStart, offscreenEnd, visibleStart, visibleEnd];
  if (!Number.isInteger(baseline.webContentsId) || baseline.webContentsId < 1) {
    throw new Error('webview-lifecycle baseline has no WebContents identity');
  }
  if (envelopes.some((entry) => entry?.webContentsId !== baseline.webContentsId)) {
    throw new Error('webview-lifecycle target WebContents changed during sleep/wake measurement');
  }
  const guestValues = envelopes.map((entry) => entry?.value);
  if (
    typeof baseline.instanceToken !== 'string' || baseline.instanceToken.length === 0
    || guestValues.some((value) => value?.instanceToken !== baseline.instanceToken)
  ) {
    throw new Error('webview-lifecycle target document instance changed during sleep/wake measurement');
  }
  const stateToken = installed?.value?.stateToken;
  if (
    installed?.value?.installed !== true
    || installed.value.marker !== true
    || typeof stateToken !== 'string' || stateToken.length === 0
    || guestValues.slice(1).some((value) => value?.marker !== true || value?.stateToken !== stateToken)
  ) {
    throw new Error('webview-lifecycle readiness marker or DOM state changed during measurement');
  }
  if (cleanup?.value?.cleaned !== true) {
    throw new Error(`webview-lifecycle guest probe cleanup failed: ${cleanup?.value?.reason ?? 'unknown'}`);
  }

  const offscreen = activityDelta(offscreenStart.value, offscreenEnd.value, 'offscreen');
  const visible = activityDelta(visibleStart.value, visibleEnd.value, 'visible');
  if (
    offscreen.elapsedMs < measurementWindowMs * 0.75
    || visible.elapsedMs < measurementWindowMs * 0.75
  ) {
    throw new Error('webview-lifecycle fixed activity window produced an undersized sample');
  }
  if (visible.raf < 10 || visible.interval < 10) {
    throw new Error(
      `webview-lifecycle visible sample is insufficient: rAF=${visible.raf}, interval=${visible.interval}`,
    );
  }
  if (offscreen.raf > Math.max(2, visible.raf * 0.1)) {
    throw new Error(
      `webview-lifecycle rAF phase contrast is missing: offscreen=${offscreen.raf}, visible=${visible.raf}`,
    );
  }
  if (offscreen.interval > Math.max(3, visible.interval * 0.2)) {
    throw new Error(
      `webview-lifecycle interval phase contrast is missing: `
      + `offscreen=${offscreen.interval}, visible=${visible.interval}`,
    );
  }
  const reductionPct = (offscreenValue, visibleValue) => (
    Math.round((1 - offscreenValue / visibleValue) * 1_000) / 10
  );

  return {
    schemaVersion: 1,
    status: 'measured',
    measurementWindowMs,
    guests: {
      total: expectedGuests,
      offscreen: surfaceBefore.offscreen,
      cssHidden: surfaceBefore.cssHidden,
      intersecting: surfaceBefore.intersecting,
    },
    target: {
      id: baseline.id,
      url: baseline.url,
      webContentsId: baseline.webContentsId,
      instanceToken: baseline.instanceToken,
    },
    offscreen,
    visible,
    phaseContrast: {
      rafReductionPct: reductionPct(offscreen.raf, visible.raf),
      intervalReductionPct: reductionPct(offscreen.interval, visible.interval),
      attribution: 'native-geometric-offscreen-vs-visible-relocate',
      cssIncrementalBenefitMeasured: false,
    },
    lifecycle: {
      offscreenBefore: true,
      relocatedIntoViewport: true,
      geometryRestored: true,
      offscreenRestored: true,
    },
    continuity: {
      webContentsIdPreserved: true,
      documentInstancePreserved: true,
      readinessMarkerPreserved: true,
      domStatePreserved: true,
    },
    cleanup: { guestProbeRemoved: true },
  };
};

export const validateWebviewDiscardRestoreMeasurement = (measurement) => {
  const { liveCap, before, afterDiscard, restore } = measurement ?? {};
  if (!Number.isInteger(liveCap) || liveCap < 1) {
    throw new Error('webview-discard-restore has no valid live guest cap');
  }
  if (before?.domGuests <= liveCap || before?.targetGuests <= liveCap) {
    throw new Error('webview-discard-restore fixture never exceeded the live guest cap');
  }
  if (!Number.isInteger(afterDiscard?.discarded) || afterDiscard.discarded < 1) {
    throw new Error('webview-discard-restore did not discard a guest');
  }
  if (afterDiscard.live > liveCap || afterDiscard.domGuests > liveCap) {
    throw new Error('webview-discard-restore DOM live guest cap was exceeded');
  }
  if (afterDiscard.targetGuests > liveCap) {
    throw new Error('webview-discard-restore CDP target guest cap was exceeded');
  }

  const beforeRestore = restore?.before;
  const afterRestore = restore?.after;
  if (
    !Number.isInteger(beforeRestore?.webContentsId)
    || !Number.isInteger(afterRestore?.webContentsId)
    || beforeRestore.webContentsId === afterRestore.webContentsId
  ) {
    throw new Error('webview-discard-restore did not create a new WebContents generation');
  }
  if (
    typeof beforeRestore?.instanceToken !== 'string'
    || typeof afterRestore?.instanceToken !== 'string'
    || beforeRestore.instanceToken === afterRestore.instanceToken
  ) {
    throw new Error('webview-discard-restore did not reload the guest document generation');
  }
  if (!beforeRestore.url || afterRestore.url !== beforeRestore.url) {
    throw new Error('webview-discard-restore did not preserve the runtime URL');
  }
  if (
    !Number.isFinite(beforeRestore.scrollY)
    || !Number.isFinite(afterRestore.scrollY)
    || Math.abs(afterRestore.scrollY - beforeRestore.scrollY) > 1
  ) {
    throw new Error('webview-discard-restore did not restore guest scroll position');
  }
  if (!Number.isFinite(restore?.readyMs) || restore.readyMs < 0) {
    throw new Error('webview-discard-restore has no restore-ready timing');
  }
  return measurement;
};

const waitForWebviewActivitySurface = async (cdp, expected, predicate, label, timeoutMs = 10_000) => {
  const startedAt = Date.now();
  let lastSurface = null;
  while (Date.now() - startedAt < timeoutMs) {
    lastSurface = await readWebviewActivitySurface(cdp, expected);
    if (predicate(lastSurface)) return lastSurface;
    await sleep(200);
  }
  throw new Error(
    `webview-lifecycle ${label} sample unavailable after ${timeoutMs}ms: `
    + `mounted=${lastSurface?.total ?? 0}/${expected.length}, `
    + `offscreen=${lastSurface?.offscreen ?? 0}, intersecting=${lastSurface?.intersecting ?? 0}`,
  );
};

const relocateWebviewActivityTarget = async (cdp, target) => {
  const result = await evaluate(cdp, `(() => {
    const expectedUrl = ${JSON.stringify(target.url)};
    const webviews = [...document.querySelectorAll('.canvas-node--iframe webview')];
    const urlOf = (webview) => {
      try {
        return webview.getURL?.() || webview.getAttribute('src') || '';
      } catch {
        return webview.getAttribute('src') || '';
      }
    };
    const webview = webviews.find((candidate) => urlOf(candidate) === expectedUrl);
    const host = webview?.closest('.iframe-frame-host');
    const node = host?.closest('.canvas-node');
    const surface = document.querySelector('.canvas-transform');
    if (!webview || !host || !node || !surface) {
      return { ok: false, reason: 'target host/node/canvas transform is missing' };
    }
    const before = host.getBoundingClientRect();
    const matrix = new DOMMatrixReadOnly(getComputedStyle(surface).transform);
    const scaleX = Math.hypot(matrix.a, matrix.b);
    const scaleY = Math.hypot(matrix.c, matrix.d);
    if (!Number.isFinite(scaleX) || scaleX <= 0 || !Number.isFinite(scaleY) || scaleY <= 0) {
      return { ok: false, reason: 'canvas scale is unavailable' };
    }
    const previousTranslate = node.style.translate;
    const previousZIndex = node.style.zIndex;
    const targetLeft = Math.max(280, (innerWidth - before.width) / 2);
    const targetTop = Math.max(80, (innerHeight - before.height) / 2);
    node.style.translate = ((targetLeft - before.left) / scaleX) + 'px '
      + ((targetTop - before.top) / scaleY) + 'px';
    node.style.zIndex = '2147483646';
    const after = host.getBoundingClientRect();
    const intersectsViewport = after.right > 0 && after.bottom > 0
      && after.left < innerWidth && after.top < innerHeight;
    if (!intersectsViewport) {
      node.style.translate = previousTranslate;
      node.style.zIndex = previousZIndex;
      return { ok: false, reason: 'translated target still does not intersect the viewport' };
    }
    return {
      ok: true,
      previousTranslate,
      previousZIndex,
      before: { left: before.left, top: before.top, width: before.width, height: before.height },
      after: { left: after.left, top: after.top, width: after.width, height: after.height },
    };
  })()`);
  if (result?.ok !== true) {
    throw new Error(`webview-lifecycle target relocation failed: ${result?.reason ?? 'unknown'}`);
  }
  return result;
};

const restoreWebviewActivityTarget = async (cdp, target, relocation) => {
  const result = await evaluate(cdp, `(() => {
    const expectedUrl = ${JSON.stringify(target.url)};
    const webviews = [...document.querySelectorAll('.canvas-node--iframe webview')];
    const urlOf = (webview) => {
      try {
        return webview.getURL?.() || webview.getAttribute('src') || '';
      } catch {
        return webview.getAttribute('src') || '';
      }
    };
    const webview = webviews.find((candidate) => urlOf(candidate) === expectedUrl);
    const host = webview?.closest('.iframe-frame-host');
    const node = host?.closest('.canvas-node');
    if (!host || !node) return { ok: false, reason: 'target host/node is missing during restore' };
    node.style.translate = ${JSON.stringify(relocation.previousTranslate)};
    node.style.zIndex = ${JSON.stringify(relocation.previousZIndex)};
    const rect = host.getBoundingClientRect();
    return {
      ok: true,
      intersectsViewport: rect.right > 0 && rect.bottom > 0
        && rect.left < innerWidth && rect.top < innerHeight,
      translateRestored: node.style.translate === ${JSON.stringify(relocation.previousTranslate)},
      zIndexRestored: node.style.zIndex === ${JSON.stringify(relocation.previousZIndex)},
    };
  })()`);
  if (
    result?.ok !== true
    || result.translateRestored !== true
    || result.zIndexRestored !== true
  ) {
    throw new Error(`webview-lifecycle target restore failed: ${result?.reason ?? 'style mismatch'}`);
  }
  return result;
};

const webviewLifecycleScenario = async (cdp, seededFixture) => {
  const expected = seededFixture?.webviews;
  if (!Array.isArray(expected) || expected.length === 0) {
    throw new Error('webview-lifecycle requires seeded deterministic loopback WebViews');
  }
  const surfaceBefore = await waitForWebviewActivitySurface(
    cdp,
    expected,
    (surface) => surface.total === expected.length && surface.offscreen > 0,
    'offscreen guest',
  );
  const targetSurface = surfaceBefore.items.find((item) => (
    item.visibility !== 'hidden' && item.intersectsViewport === false
  ));
  if (!targetSurface) {
    throw new Error(
      `webview-lifecycle has no geometrically offscreen guest despite ${surfaceBefore.offscreen} offscreen host(s)`,
    );
  }
  const baseline = expected.find((item) => item.url === targetSurface.url);
  if (!baseline) throw new Error('webview-lifecycle target has no readiness baseline');

  let installed = null;
  let offscreenStart = null;
  let offscreenEnd = null;
  let visibleStart = null;
  let visibleEnd = null;
  let surfaceAfterOffscreen = null;
  let surfaceVisible = null;
  let surfaceRestored = null;
  let cleanup = null;
  let relocation = null;
  let restore = null;
  let measurementError = null;
  try {
    installed = await runWebviewGuestScript(
      cdp,
      baseline,
      'probe install',
      installWebviewActivityProbeSource,
    );
    offscreenStart = await runWebviewGuestScript(
      cdp,
      baseline,
      'offscreen sample start',
      sampleWebviewActivityProbeSource,
    );
    await sleep(WEBVIEW_ACTIVITY_WINDOW_MS);
    offscreenEnd = await runWebviewGuestScript(
      cdp,
      baseline,
      'offscreen sample end',
      sampleWebviewActivityProbeSource,
    );
    surfaceAfterOffscreen = await readWebviewActivitySurface(cdp, expected);

    relocation = await relocateWebviewActivityTarget(cdp, baseline);
    surfaceVisible = await waitForWebviewActivitySurface(
      cdp,
      expected,
      (surface) => {
        const target = surface.items.find((item) => item.url === baseline.url);
        return surface.total === expected.length
          && target?.visibility !== 'hidden'
          && target?.intersectsViewport === true;
      },
      'visible guest',
      5_000,
    );
    await sleep(WEBVIEW_VISIBLE_SETTLE_MS);
    visibleStart = await runWebviewGuestScript(
      cdp,
      baseline,
      'visible sample start',
      sampleWebviewActivityProbeSource,
    );
    await sleep(WEBVIEW_ACTIVITY_WINDOW_MS);
    visibleEnd = await runWebviewGuestScript(
      cdp,
      baseline,
      'visible sample end',
      sampleWebviewActivityProbeSource,
    );
  } catch (error) {
    measurementError = error;
  } finally {
    if (installed) {
      try {
        cleanup = await runWebviewGuestScript(
          cdp,
          baseline,
          'probe cleanup',
          cleanupWebviewActivityProbeSource,
        );
      } catch (error) {
        if (!measurementError) measurementError = error;
      }
    }
    if (relocation) {
      try {
        restore = await restoreWebviewActivityTarget(cdp, baseline, relocation);
      } catch (error) {
        if (measurementError) {
          const primary = measurementError instanceof Error
            ? measurementError.message
            : String(measurementError);
          const secondary = error instanceof Error ? error.message : String(error);
          measurementError = new Error(`${primary}; additionally ${secondary}`);
        } else {
          measurementError = error;
        }
      }
    }
  }
  if (measurementError) throw measurementError;
  surfaceRestored = await waitForWebviewActivitySurface(
    cdp,
    expected,
    (surface) => {
      const target = surface.items.find((item) => item.url === baseline.url);
      return surface.total === expected.length
        && target?.visibility !== 'hidden'
        && target?.intersectsViewport === false;
    },
    'restored offscreen guest',
    5_000,
  );

  return validateWebviewLifecycleMeasurement({
    expectedGuests: expected.length,
    surfaceBefore,
    surfaceAfterOffscreen,
    surfaceVisible,
    surfaceRestored,
    baseline,
    installed,
    offscreenStart,
    offscreenEnd,
    visibleStart,
    visibleEnd,
    cleanup,
    relocation,
    restore,
  });
};

const readMainRssSamples = async (session) => {
  const stdout = await fs.readFile(session.logFiles.stdout, 'utf-8').catch(() => '');
  return [...stdout.matchAll(/\[perf\] loop-delay (\{.*\})/g)]
    .map((match) => JSON.parse(match[1]))
    .filter((sample) => Number.isFinite(sample.rssKb));
};

const countWebviewTargets = async (session) => (
  (await getTargets(session)).filter((target) => target.type === 'webview').length
);

const webviewDiscardRestoreScenario = async (cdp, seededFixture, session) => {
  const expected = seededFixture?.webviews;
  if (!Array.isArray(expected) || expected.length <= WEBVIEW_LIVE_CAP) {
    throw new Error(
      `webview-discard-restore requires more than ${WEBVIEW_LIVE_CAP} seeded loopback WebViews`,
    );
  }

  const prepareGuestSource = `(() => {
    window.scrollTo(0, 240);
    return {
      instanceToken: window[${JSON.stringify(WEBVIEW_FIXTURE_INSTANCE_TOKEN)}] ?? null,
      scrollY: window.scrollY,
      url: location.href,
    };
  })()`;
  const before = await evaluate(cdp, `(async () => {
    const api = window.__pulseWebviewLifecycle;
    if (!api) throw new Error('webview lifecycle debug API is unavailable');
    const wanted = new Set(${JSON.stringify(expected.map((entry) => entry.id))});
    const entries = api.snapshot().entries.filter((entry) => wanted.has(entry.nodeId));
    const items = (await Promise.all(entries.map(async (entry) => {
      const host = [...document.querySelectorAll('[data-webview-node-id]')]
        .find((candidate) => candidate.dataset.webviewNodeId === entry.nodeId);
      const webview = host?.querySelector('webview');
      if (!webview) return null;
      let webContentsId = null;
      try { webContentsId = webview.getWebContentsId(); } catch { /* validated below */ }
      const guest = await webview.executeJavaScript(${JSON.stringify(prepareGuestSource)}, true);
      return { id: entry.id, nodeId: entry.nodeId, webContentsId, ...guest };
    }))).filter(Boolean);
    return {
      lifecycle: api.snapshot(),
      domGuests: document.querySelectorAll('.canvas-node--iframe webview').length,
      items,
    };
  })()`);
  if (before.items.length !== expected.length) {
    throw new Error(
      `webview-discard-restore baseline guest mismatch: ${before.items.length}/${expected.length}`,
    );
  }

  let rssSamples = await readMainRssSamples(session);
  if (rssSamples.length === 0) {
    await sleep(2_100);
    rssSamples = await readMainRssSamples(session);
  }
  const rssBeforeKb = rssSamples.at(-1)?.rssKb ?? null;
  const rssSampleCountBefore = rssSamples.length;
  const targetGuestsBefore = await countWebviewTargets(session);

  await evaluate(cdp, `window.__pulseWebviewLifecycle.forceReconcile()`);
  const afterDiscard = await waitFor(async () => {
    const value = await evaluate(cdp, `(() => {
      const lifecycle = window.__pulseWebviewLifecycle?.snapshot();
      const domGuests = document.querySelectorAll('.canvas-node--iframe webview').length;
      if (!lifecycle) return null;
      return {
        lifecycle,
        domGuests,
        discarded: lifecycle.entries.filter((entry) => entry.state === 'discarded').length,
      };
    })()`);
    return value
      && value.lifecycle.liveCount <= value.lifecycle.liveCap
      && value.domGuests <= value.lifecycle.liveCap
      && value.discarded > 0
      ? value
      : false;
  }, 15_000);
  const targetResult = await waitFor(async () => {
    const count = await countWebviewTargets(session);
    return count <= afterDiscard.lifecycle.liveCap ? { count } : false;
  }, 15_000);

  await waitFor(async () => {
    const samples = await readMainRssSamples(session);
    return samples.length > rssSampleCountBefore ? samples : false;
  }, 6_000).catch(() => null);
  const rssAfterSamples = await readMainRssSamples(session);
  const rssAfterDiscardKb = rssAfterSamples.at(-1)?.rssKb ?? null;

  const beforeByNode = new Map(before.items.map((item) => [item.nodeId, item]));
  const discardedEntry = afterDiscard.lifecycle.entries.find((entry) => (
    entry.state === 'discarded' && beforeByNode.has(entry.nodeId)
  ));
  if (!discardedEntry) throw new Error('webview-discard-restore has no restorable discarded guest');
  const restoreBefore = beforeByNode.get(discardedEntry.nodeId);
  const restoreStartedAt = Date.now();
  await evaluate(
    cdp,
    `window.__pulseWebviewLifecycle.wake(${JSON.stringify(discardedEntry.id)})`,
  );
  const inspectGuestSource = `(() => ({
    instanceToken: window[${JSON.stringify(WEBVIEW_FIXTURE_INSTANCE_TOKEN)}] ?? null,
    scrollY: window.scrollY,
    url: location.href,
  }))()`;
  const restored = await waitFor(async () => {
    const value = await evaluate(cdp, `(async () => {
      const nodeId = ${JSON.stringify(discardedEntry.nodeId)};
      const host = [...document.querySelectorAll('[data-webview-node-id]')]
        .find((candidate) => candidate.dataset.webviewNodeId === nodeId);
      const wrapper = host?.closest('.iframe-frame-wrapper');
      const webview = host?.querySelector('webview');
      if (!webview || wrapper?.dataset.webviewLifecycle !== 'live') return null;
      let webContentsId = null;
      try { webContentsId = webview.getWebContentsId(); } catch { return null; }
      try {
        const guest = await webview.executeJavaScript(${JSON.stringify(inspectGuestSource)}, true);
        return { webContentsId, ...guest };
      } catch { return null; }
    })()`).catch(() => null);
    return value?.instanceToken ? value : false;
  }, 15_000);

  const measurement = validateWebviewDiscardRestoreMeasurement({
    schemaVersion: 1,
    status: 'measured',
    liveCap: afterDiscard.lifecycle.liveCap,
    before: {
      domGuests: before.domGuests,
      live: before.lifecycle.liveCount,
      targetGuests: targetGuestsBefore,
      rssMb: Number.isFinite(rssBeforeKb) ? Math.round(rssBeforeKb / 1024 * 10) / 10 : null,
    },
    afterDiscard: {
      discarded: afterDiscard.discarded,
      domGuests: afterDiscard.domGuests,
      live: afterDiscard.lifecycle.liveCount,
      targetGuests: targetResult.count,
      rssMb: Number.isFinite(rssAfterDiscardKb)
        ? Math.round(rssAfterDiscardKb / 1024 * 10) / 10
        : null,
      rssReleasedMb: Number.isFinite(rssBeforeKb) && Number.isFinite(rssAfterDiscardKb)
        ? Math.round((rssBeforeKb - rssAfterDiscardKb) / 1024 * 10) / 10
        : null,
    },
    restore: {
      nodeId: discardedEntry.nodeId,
      before: restoreBefore,
      after: restored,
      readyMs: Date.now() - restoreStartedAt,
    },
  });

  // Leave the diagnostic session back at the production cap.
  await evaluate(cdp, `window.__pulseWebviewLifecycle.forceReconcile()`);
  return measurement;
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
    welcomeLocalContentMs: probe.marks['welcome:local-content-ready'],
  };
};

const readStartupWelcomeLocalContentMs = async (cdp) => {
  await beginPerf(cdp, '_startup_welcome_preseed');
  const probe = await endPerf(cdp);
  const value = probe?.marks?.['welcome:local-content-ready'];
  return Number.isFinite(value) ? value : null;
};

export const mergeStartupWelcomeEvidence = ({ startup, initialWelcomeLocalContentMs }) => {
  if (Number.isFinite(startup?.welcomeLocalContentMs)) {
    return { ...startup, welcomeLocalContentSource: 'seeded-reload' };
  }
  if (Number.isFinite(initialWelcomeLocalContentMs)) {
    return {
      ...startup,
      welcomeLocalContentMs: initialWelcomeLocalContentMs,
      welcomeLocalContentSource: 'initial-pre-seed',
    };
  }
  return startup;
};

const chatStreamScenario = async (cdp) => {
  const inputSel = '.chat-panel .chat-input[contenteditable="true"]';
  const sendSel = '.chat-panel .chat-send-btn:not(.chat-send-btn--stop)';
  await evaluate(cdp, `document.querySelector('.ui-drawer-close')?.click()`);
  await evaluate(cdp, `document.querySelector('.chat-floating-button')?.click()`);
  await waitFor(() => evaluate(cdp, `!!document.querySelector(${JSON.stringify(inputSel)})`), 10_000)
    .catch(() => { throw new Error('chat panel did not mount after opening the right dock'); });
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

  // A settled render only proves the cache can be populated. Move a real
  // canvas node by a few pixels so the nodes array identity changes and the
  // latest, unchanged assistant Markdown is rendered again through the
  // production ChatMessage useMemo path. That second pass must hit cache.
  const cacheProbePoint = await hittablePointIn(cdp, '.canvas-node .node-header');
  if (!cacheProbePoint) {
    throw new Error('chat cache probe could not find a hittable canvas node header');
  }
  await mouse(cdp, 'mousePressed', cacheProbePoint.x, cacheProbePoint.y, {
    button: 'left', buttons: 1, clickCount: 1,
  });
  await mouse(cdp, 'mouseMoved', cacheProbePoint.x + 8, cacheProbePoint.y + 4, { buttons: 1 });
  await mouse(cdp, 'mouseReleased', cacheProbePoint.x + 8, cacheProbePoint.y + 4, {
    button: 'left', buttons: 0, clickCount: 1,
  });
  await markActiveEnd(cdp);
  // Let the drag-triggered save debounce settle before the next scenario;
  // the frame window is already frozen, but counters remain active.
  await drainCanvasSave();

  const report = await endPerf(cdp);
  await closeActiveChatDock(cdp);
  if ((report.counters['chat-md-stream-render'] ?? 0) <= 0) {
    throw new Error('chat-stream replay produced no streaming markdown renders');
  }
  if ((report.counters['nodes-array-replace'] ?? 0) <= 0) {
    throw new Error('chat cache probe node drag did not replace the nodes array');
  }
  const hits = report.counters['chat-md-cache-hit'] ?? 0;
  const renders = report.counters['chat-md-render'] ?? 0;
  const opportunities = hits + renders;
  if (hits <= 0) {
    throw new Error(
      `chat cache probe produced no cache hit (${renders} settled misses across ${opportunities} opportunities)`,
    );
  }
  return {
    report,
    tailBurstMs,
    markdownRenders: report.counters['chat-md-stream-render'],
    cacheProbe: {
      hits,
      renders,
      opportunities,
      ratio: Math.round((hits / opportunities) * 1000) / 10,
    },
  };
};

const ptyStreamScenario = async (cdp) => {
  await beginPerf(cdp, 'pty-stream');
  const result = await evaluate(cdp, `(async () => {
    const api = window.canvasWorkspace.pty;
    const ids = ['perf-pty-a', 'perf-pty-b'];
    const spawned = await Promise.all(ids.map(id => api.spawn(id, 80, 24)));
    const failed = spawned.find(entry => !entry?.ok);
    if (failed) throw new Error('PTY spawn failed: ' + (failed.error || 'unknown error'));
    await new Promise(resolve => setTimeout(resolve, 250));
    ids.forEach(id => api.write(id, 'stty -echo\\r'));
    await new Promise(resolve => setTimeout(resolve, 150));

    const run = (id, index) => new Promise((resolve, reject) => {
      const marker = '__PULSE_PTY_PERF_DONE_' + index + '__';
      let events = 0;
      let bytes = 0;
      const startedAt = performance.now();
      let unsubscribeData = () => {};
      let unsubscribeExit = () => {};
      const timer = setTimeout(() => {
        unsubscribeData();
        unsubscribeExit();
        reject(new Error('PTY stream timed out: ' + id));
      }, 15_000);
      const finish = () => {
        clearTimeout(timer);
        unsubscribeData();
        unsubscribeExit();
        resolve({ events, bytes, startedAt, endedAt: performance.now() });
      };
      unsubscribeData = api.onData(id, data => {
        events++;
        bytes += data.length;
        if (data.includes(marker)) finish();
      });
      unsubscribeExit = api.onExit(id, code => {
        clearTimeout(timer);
        unsubscribeData();
        unsubscribeExit();
        reject(new Error('PTY exited early (' + code + '): ' + id));
      });
      const command = 'i=0; while [ $i -lt 200 ]; do printf "pulse-perf-%04d-xxxxxxxx\\n" "$i"; i=$((i+1)); sleep 0.005; done; '
        + 'm="__PULSE_PTY_PERF_DONE_"; printf "%s%d__\\n" "$m" ' + index;
      api.write(id, command + '\\r');
    });

    try {
      const results = await Promise.all(ids.map((id, index) => run(id, index)));
      const startedAt = Math.min(...results.map(entry => entry.startedAt));
      const endedAt = Math.max(...results.map(entry => entry.endedAt));
      const durationMs = endedAt - startedAt;
      const events = results.reduce((sum, entry) => sum + entry.events, 0);
      const bytes = results.reduce((sum, entry) => sum + entry.bytes, 0);
      return {
        terminals: ids.length,
        events,
        bytes,
        durationMs: Math.round(durationMs * 10) / 10,
        ipcPerSec: Math.round((events / durationMs) * 10000) / 10,
      };
    } finally {
      ids.forEach(id => api.kill(id));
    }
  })()`);
  const report = await endPerf(cdp);
  if (!result || result.events <= 0 || result.durationMs <= 0) {
    throw new Error('pty-stream produced no measurable IPC traffic');
  }
  return { ...result, report };
};

const typingScenario = async (cdp, repeatCount = 1) => {
  const editorSel = '.canvas-node--file .ProseMirror';
  const previewSel = '.canvas-node--file .file-preview--editable';
  await waitFor(
    () => evaluate(cdp, `!!document.querySelector(${JSON.stringify(previewSel)})`),
    10_000,
  ).catch(() => { throw new Error(`file preview did not mount (${previewSel})`); });
  await evaluate(cdp, `document.querySelector(${JSON.stringify(previewSel)})?.click()`);
  // File nodes now mount a lightweight Markdown preview. The first click
  // crosses the editor boundary; wait for Tiptap before measuring typing.
  await waitFor(
    () => evaluate(cdp, `!!document.querySelector(${JSON.stringify(editorSel)})`),
    10_000,
  ).catch(() => { throw new Error(`file editor did not mount after preview activation (${editorSel})`); });
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
    await markActiveEnd(cdp);
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
    await markActiveEnd(cdp);
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
    await markActiveEnd(cdp);
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

// Isolated first-wheel regression: unlike panzoom below, every repeat waits
// until both the React moving state and transform animation class are absent,
// then dispatches exactly one ctrl+wheel. This captures the cold transition
// into gesture-only rendering instead of measuring a pan-warmed compositor.
export const zoomColdScenario = async (cdp, repeatCount = 1) => {
  const reports = [];
  for (let run = 0; run < repeatCount; run++) {
    const restBefore = await waitForColdZoomRest(cdp);
    const point = await findBlankCanvasPoint(cdp);
    await installWheelToNextFrameProbe(cdp);
    await installWheelToPresentedFrameProbe(cdp, restBefore.transform);
    await beginPerf(cdp, 'zoom-cold');
    const deltaY = coldZoomDeltaForScale(restBefore.scale);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: point.x, y: point.y,
      deltaX: 0, deltaY, modifiers: 2,
    });
    await markActiveEnd(cdp);
    const wheelToNextFrame = await finishWheelToNextFrameProbe(cdp);
    const wheelToPresentedFrame = await finishWheelToPresentedFrameProbe(cdp);
    const after = await readColdZoomState(cdp);
    const report = await endPerf(cdp);
    const evidence = validateColdZoomRun({
      restBefore,
      wheelToNextFrame,
      wheelToPresentedFrame,
      transformBefore: restBefore.transform,
      transformAfter: after.transform,
    });
    reports.push({
      ...report,
      ...evidence,
      wheelToNextFrame,
      wheelToPresentedFrame,
      wheelDeltaY: deltaY,
      scaleBefore: restBefore.scale,
    });
  }
  return {
    coldStartVerified: true,
    transformChanged: true,
    report: aggregateReports(reports),
  };
};

// A4: pan (plain wheel — the app treats unmodified wheel deltas as a direct
// transform translate, see useCanvas.ts handleWheel) and zoom (ctrl+wheel —
// modifiers bit 2 = Ctrl in the CDP Input domain) over a genuinely blank
// canvas point (found via findBlankCanvasPoint — a wheel dispatched over a
// node gets consumed by that node's own scroll/webview handling and never
// reaches the canvas-level handler). Guards the interact aspect's panzoom
// north star; no counter guard (pan/zoom never touch the nodes array).
// interactions.p95 (INP) structurally reads 0 here — wheel/scroll isn't in
// the Event Timing API's discrete-interaction set. The response north star is
// therefore the verified wheel→next-frame probe, with frame stats alongside.
const dispatchPanzoomGesture = async (cdp, point, {
  panSteps = 30,
  zoomSteps = 20,
} = {}) => {
  for (let i = 0; i < panSteps; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: point.x, y: point.y, deltaX: 6, deltaY: 4,
    });
    await sleep(16);
  }
  // Alternate zoom-in/zoom-out so repeated runs don't drift the scale into
  // its clamp (which would make later repeats measure less work).
  for (let i = 0; i < zoomSteps; i++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel', x: point.x, y: point.y,
      deltaX: 0, deltaY: i % 2 === 0 ? -20 : 20, modifiers: 2,
    });
    await sleep(16);
  }
  return panSteps + zoomSteps;
};

const panzoomScenario = async (cdp, repeatCount = 1) => {
  const wheelSamplesPerRun = 50;
  const reports = [];
  for (let run = 0; run < repeatCount; run++) {
    await waitForColdZoomRest(cdp);
    const point = await findBlankCanvasPoint(cdp);
    const transformBefore = await evaluate(cdp, `(() => {
      const el = document.querySelector('.canvas-transform');
      if (!el) throw new Error('canvas transform element missing');
      return getComputedStyle(el).transform;
    })()`);
    await installWheelToNextFrameProbe(cdp);
    await beginPerf(cdp, 'panzoom');
    await dispatchPanzoomGesture(cdp, point);
    await markActiveEnd(cdp);
    const wheelToNextFrame = await finishWheelToNextFrameProbe(cdp);
    if (wheelToNextFrame.count !== wheelSamplesPerRun) {
      throw new Error(
        `panzoom wheel-to-next-frame probe captured ${wheelToNextFrame.count}/${wheelSamplesPerRun} wheel events`,
      );
    }
    const transformAfter = await evaluate(cdp, `(() => {
      const el = document.querySelector('.canvas-transform');
      if (!el) throw new Error('canvas transform element missing after gesture');
      return getComputedStyle(el).transform;
    })()`);
    if (transformAfter === transformBefore) {
      throw new Error(`panzoom gesture did not change .canvas-transform (${transformBefore})`);
    }
    const report = await endPerf(cdp);
    reports.push({ ...report, wheelToNextFrame, transformChanged: true });
  }
  return { transformChanged: true, report: aggregateReports(reports) };
};

// Diagnostic interaction trace: unlike the lightweight panzoom counter run,
// this intentionally keeps recording through MOVING_IDLE_MS and the 140ms
// scale settle so GPU/raster/style work is not hidden just after the final
// wheel event. It is opt-in because browser-wide Chrome traces are heavier.
const panzoomTraceScenario = async (cdp) => {
  const wheelSamples = 50;
  await waitForColdZoomRest(cdp);
  const point = await findBlankCanvasPoint(cdp);
  // Give offscreen WebView observation its 1.5s stability window before the
  // trace starts; this delay is outside the measured action.
  await sleep(1_700);
  await waitForCalmFrames(cdp);
  const surfaceBefore = await readPanzoomSurface(cdp);
  const transformBefore = await evaluate(cdp, `getComputedStyle(
    document.querySelector('.canvas-transform')
  ).transform`);
  await installWheelToNextFrameProbe(cdp);
  await beginPerf(cdp, 'panzoom-trace');

  const trace = await captureInteractionTrace(cdp, {
    rawTracePath: panzoomTracePath,
    action: async () => {
      await dispatchPanzoomGesture(cdp, point);
      await waitForColdZoomRest(cdp);
      // CanvasSurface's custom-property transition is not represented by the
      // moving class; keep the trace open through its 140ms duration.
      await sleep(160);
      const wheelToNextFrame = await finishWheelToNextFrameProbe(cdp);
      if (wheelToNextFrame.count !== wheelSamples) {
        throw new Error(
          `panzoom trace captured ${wheelToNextFrame.count}/${wheelSamples} wheel events`,
        );
      }
      const transformAfter = await evaluate(cdp, `getComputedStyle(
        document.querySelector('.canvas-transform')
      ).transform`);
      if (transformAfter === transformBefore) {
        throw new Error(`panzoom trace did not change .canvas-transform (${transformBefore})`);
      }
      await markActiveEnd(cdp);
      const report = await endPerf(cdp);
      return {
        transformChanged: true,
        wheelToNextFrame,
        report,
        surfaceBefore,
        surfaceAfter: await readPanzoomSurface(cdp),
      };
    },
  });

  return {
    ...trace,
    report: trace.action.report,
    surface: {
      before: trace.action.surfaceBefore,
      after: trace.action.surfaceAfter,
    },
  };
};

const zoomSettleScenario = async (cdp, repeatCount = 1) => {
  const reports = [];
  const settles = [];
  for (let run = 0; run < repeatCount; run++) {
    await waitForColdZoomRest(cdp);
    const point = await findBlankCanvasPoint(cdp);
    await installZoomSettleProbe(cdp);
    await beginPerf(cdp, 'zoom-settle');
    await dispatchPanzoomGesture(cdp, point, { panSteps: 0, zoomSteps: 20 });
    let settle;
    try {
      settle = await finishZoomSettleProbe(cdp);
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; point=${JSON.stringify(point)}`);
    }
    if (!settle.sawMoving || settle.canvasMoving || settle.transformMoving) {
      throw new Error(`zoom-settle ended in an invalid state: ${JSON.stringify(settle)}`);
    }
    await markActiveEnd(cdp);
    reports.push(await endPerf(cdp));
    settles.push(settle.lastWheelToRestMs);
  }
  return {
    report: aggregateReports(reports),
    lastWheelToRestMs: medianNumber(settles),
    rawLastWheelToRestMs: settles,
    includesSettleTransitionMs: 160,
  };
};

// Memory-retention scenario (H1 guard): seed equal-load workspaces, enter the
// first dedicated perf workspace before taking a baseline, then visit enough
// additional workspaces to cross the active + 3-background LRU capacity.
// heapSlopeMB is intentionally the post-capacity tail slope: startup/mount
// growth no longer hides whether evicted workspaces actually release memory.
const wsCycleScenario = async (cdp, requestedNodesPerWorkspace = 0) => {
  const K = 8;
  const MOUNTED_WORKSPACE_CAPACITY = 4;
  const nodesPer = Math.max(30, Number.isFinite(requestedNodesPerWorkspace)
    ? Math.floor(requestedNodesPerWorkspace)
    : 30);
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
  await cdp.reconnect();
  await waitFor(
    () => evaluate(cdp, `window.__pulsePerf
      && [...document.querySelectorAll('.sidebar-item')]
        .filter((entry) => /^perf [1-8]$/.test(entry.getAttribute('title') || '')).length === ${K}`)
      .catch(() => false),
    30_000,
  );
  const perfEntryCount = await evaluate(cdp, `[...document.querySelectorAll('.sidebar-item')]
    .filter((entry) => /^perf [1-8]$/.test(entry.getAttribute('title') || '')).length`);
  if (perfEntryCount !== K) {
    throw new Error(`ws-cycle sidebar validation failed: ${perfEntryCount}/${K} perf workspaces`);
  }
  await waitForCalmFrames(cdp);

  const heaps = [];
  const mountedWorkspaceCounts = [];
  for (let n = 1; n <= K; n++) {
    const point = await evaluate(cdp, `(() => {
      const el = [...document.querySelectorAll('.sidebar-item')]
        .find((entry) => entry.getAttribute('title') === 'perf ${n}');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    if (!point) throw new Error(`ws-cycle could not find sidebar entry perf ${n}`);
    await clickAt(cdp, point.x, point.y);
    await waitFor(
      () => evaluate(cdp, `(() => {
        const active = document.querySelector('.sidebar-item--active');
        if (active?.getAttribute('title') !== 'perf ${n}') return false;
        const visibleHost = [...document.querySelectorAll('.canvas-host')]
          .find((host) => getComputedStyle(host).display !== 'none');
        return (visibleHost?.querySelectorAll('.canvas-node').length ?? 0) >= ${nodesPer};
      })()`).catch(() => false),
      30_000,
    );
    await waitForCalmFrames(cdp);
    await sleep(400);
    heaps.push(await sampleRetainedHeapMB(cdp));
    mountedWorkspaceCounts.push(await evaluate(cdp, `document.querySelectorAll('.canvas-host').length`));
  }
  const postCapacityHeapsMB = heaps.slice(MOUNTED_WORKSPACE_CAPACITY - 1);
  return {
    workspaces: K,
    nodesPerWorkspace: nodesPer,
    heapsMB: heaps,
    postCapacityHeapsMB,
    heapSlopeMB: slope(postCapacityHeapsMB),
    peakHeapMB: Math.max(...heaps),
    mountedWorkspaceCounts,
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

const selectSeedNodeIds = (existingIds, count) => {
  const existing = new Set(existingIds);
  const selected = [];
  for (let index = 0; selected.length < count; index++) {
    const id = `${PERF_SEED_NODE_PREFIX}${index}`;
    if (!existing.has(id)) selected.push(id);
  }
  return selected;
};

const readUrlWebviewReadiness = (cdp, expected) => evaluate(cdp, `(async () => {
  const expected = ${JSON.stringify(expected)};
  const expectedUrls = new Set(expected.map((item) => item.url));
  const all = [...document.querySelectorAll('.canvas-node--iframe webview')];
  const urlOf = (webview) => {
    try {
      return webview.getURL?.() || webview.getAttribute('src') || '';
    } catch {
      return webview.getAttribute('src') || '';
    }
  };
  const matching = all.filter((webview) => expectedUrls.has(urlOf(webview)));
  const items = await Promise.all(expected.map(async (wanted) => {
    const webview = matching.find((candidate) => urlOf(candidate) === wanted.url);
    if (!webview) {
      return {
        id: null,
        url: null,
        isLoading: null,
        marker: false,
        webContentsId: null,
        instanceToken: null,
      };
    }
    const url = urlOf(webview);
    let id = null;
    try {
      id = decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? '');
    } catch { /* URL mismatch is reported by the outer contract. */ }
    let isLoading = null;
    try { isLoading = webview.isLoading(); } catch { /* guest is not attached yet */ }
    let webContentsId = null;
    try { webContentsId = webview.getWebContentsId(); } catch { /* guest is not attached yet */ }
    let marker = false;
    let instanceToken = null;
    if (isLoading === false) {
      try {
        const guestState = await webview.executeJavaScript(
          ${JSON.stringify(`(() => ({
            marker: window[${JSON.stringify(WEBVIEW_FIXTURE_READY_MARKER)}] === true,
            instanceToken: window[${JSON.stringify(WEBVIEW_FIXTURE_INSTANCE_TOKEN)}] ?? null,
          }))()`)},
          true,
        );
        marker = guestState?.marker === true;
        instanceToken = guestState?.instanceToken ?? null;
      } catch { /* guest DOM is not ready yet */ }
    }
    return { id, url, isLoading, marker, webContentsId, instanceToken };
  }));
  return { count: all.length, items };
})()`);

const temporarilyFitWebpagesInViewport = (cdp) => evaluate(cdp, `(() => {
  const viewport = document.querySelector('.canvas-container');
  const surface = document.querySelector('.canvas-transform');
  const nodes = [...document.querySelectorAll('.canvas-node--iframe')];
  if (!viewport || !surface || nodes.length === 0) {
    return { ok: false, reason: 'canvas surface or webpage nodes missing' };
  }
  const boxes = nodes.map((node) => {
    const matrix = new DOMMatrixReadOnly(getComputedStyle(node).transform);
    return {
      left: matrix.e,
      top: matrix.f,
      right: matrix.e + node.offsetWidth,
      bottom: matrix.f + node.offsetHeight,
    };
  });
  const minX = Math.min(...boxes.map((box) => box.left));
  const minY = Math.min(...boxes.map((box) => box.top));
  const maxX = Math.max(...boxes.map((box) => box.right));
  const maxY = Math.max(...boxes.map((box) => box.bottom));
  const margin = 48;
  const requiredScale = Math.min(
    1,
    (viewport.clientWidth - margin * 2) / Math.max(1, maxX - minX),
    (viewport.clientHeight - margin * 2) / Math.max(1, maxY - minY),
  );
  if (!Number.isFinite(requiredScale) || requiredScale < 0.1) {
    return { ok: false, reason: 'webpage fixture does not fit at the minimum canvas scale' };
  }
  const previousTransform = surface.style.transform;
  const x = margin - minX * requiredScale;
  const y = margin - minY * requiredScale;
  surface.style.transform = 'translate(' + x + 'px, ' + y + 'px) scale(' + requiredScale + ')';
  surface.getBoundingClientRect();
  return { ok: true, previousTransform, scale: requiredScale };
})()`);

const restoreCanvasTransform = (cdp, transform) => evaluate(cdp, `(() => {
  const surface = document.querySelector('.canvas-transform');
  if (!surface) throw new Error('canvas transform missing while restoring fixture viewport');
  const expected = ${JSON.stringify(transform)};
  surface.style.transform = expected;
  surface.getBoundingClientRect();
  return { ok: surface.style.transform === expected, expected, actual: surface.style.transform };
})()`);

export const assertCanvasTransformRestored = (result) => {
  if (result?.ok !== true) {
    throw new Error(
      `canvas transform restore failed: expected=${JSON.stringify(result?.expected)} `
      + `actual=${JSON.stringify(result?.actual)}`,
    );
  }
  return true;
};

const waitForUrlWebviews = async (cdp, expected) => {
  const fitted = await temporarilyFitWebpagesInViewport(cdp);
  if (!fitted?.ok) throw new Error(`cannot mount URL webview fixture: ${fitted?.reason ?? 'unknown'}`);

  // Production intentionally avoids waking tiny pages during fit-all. The
  // explicit fixture needs every guest alive so lifecycle diagnostics can
  // establish a full-residency baseline before forcing the cap.
  await evaluate(cdp, `(() => {
    const api = window.__pulseWebviewLifecycle;
    if (!api) return { woke: 0 };
    const expectedIds = new Set(${JSON.stringify(expected.map((entry) => entry.id))});
    const entries = api.snapshot().entries.filter((entry) => expectedIds.has(entry.nodeId));
    for (const entry of entries) api.wake(entry.id);
    return { woke: entries.length };
  })()`);

  let lastObserved = null;
  let lastError = 'no readiness sample';
  try {
    for (let attempt = 0; attempt < 60; attempt++) {
      await sleep(500);
      lastObserved = await readUrlWebviewReadiness(cdp, expected).catch(() => null);
      try {
        return assertUrlWebviewReadiness(expected, lastObserved);
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
  } finally {
    assertCanvasTransformRestored(
      await restoreCanvasTransform(cdp, fitted.previousTransform),
    );
  }
  throw new Error(
    `URL webview fixture did not become ready: ${lastError}; `
    + `last observed=${JSON.stringify(lastObserved)}`,
  );
};

// Seed extra nodes into the active workspace and reload so the canvas renders
// an exact N/M/U fixture. Only the known temp-profile base webpage and our own
// perf-seed nodes may be normalized; all unknown user nodes remain immutable.
const seedExtraNodes = async ({
  cdp,
  count,
  webpageCount = 0,
  urlWebviewCount = 0,
  fixtureServer = null,
}) => {
  if (urlWebviewCount > 0 && !fixtureServer) {
    throw new Error('URL webview seeding requires a running fixture server');
  }
  const initial = await evaluate(cdp, `(async () => {
    const store = window.canvasWorkspace.store;
    const list = await store.list();
    const loaded = await store.load(list.ids[0]);
    const nodes = Array.isArray(loaded.data?.nodes) ? loaded.data.nodes : [];
    return {
      nodes: nodes.map((node) => ({
        id: node.id,
        type: node.type,
        mode: node.data?.mode ?? null,
      })),
      nodeIds: nodes.map((node) => node.id),
    };
  })()`);
  const normalization = planExistingFixtureNormalization({
    nodes: initial.nodes,
    targetTotal: count,
    targetWebpages: webpageCount,
    targetUrlWebviews: urlWebviewCount,
  });
  const plan = planSeededFixture({
    initialTotal: normalization.normalizedTotal,
    initialWebpages: normalization.normalizedWebpages,
    initialUrlWebviews: normalization.normalizedUrlWebviews,
    targetTotal: count,
    targetWebpages: webpageCount,
    targetUrlWebviews: urlWebviewCount,
  });
  const webpageOrdinals = new Set(plan.webpageOrdinals);
  const urlWebviewOrdinals = new Set(plan.urlWebviewOrdinals);
  const addedIds = selectSeedNodeIds(initial.nodeIds, plan.additions);
  const addedSpecs = addedIds.map((id, ordinal) => {
    const kind = urlWebviewOrdinals.has(ordinal)
      ? 'url'
      : webpageOrdinals.has(ordinal) ? 'html' : 'text';
    return {
      id,
      ordinal,
      kind,
      url: kind === 'url' ? fixtureServer.urlFor(id) : '',
    };
  });
  const normalizationSpecs = normalization.specs.map((spec) => ({
    ...spec,
    url: spec.kind === 'url' ? fixtureServer.urlFor(spec.id) : '',
  }));
  const existingUrlEntries = normalizationSpecs
    .filter((spec) => spec.kind === 'url')
    .map(({ id, url }) => ({ id, url }));
  const expectedUrlWebviews = [
    ...existingUrlEntries,
    ...addedSpecs.filter((spec) => spec.kind === 'url').map(({ id, url }) => ({ id, url })),
  ];
  const strideX = webpageCount > 0 ? 560 : 240;
  const strideY = webpageCount > 0 ? 420 : 160;
  const persisted = await evaluate(cdp, `(async () => {
    const store = window.canvasWorkspace.store;
    const list = await store.list();
    const wsId = list.ids[0];
    const loaded = await store.load(wsId);
    const data = loaded.data ?? {};
    const nodes = Array.isArray(data.nodes) ? data.nodes : [];
    const normalize = new Map(
      ${JSON.stringify(normalizationSpecs.map((spec) => [spec.id, spec]))},
    );
    const now = Date.now();
    const webpageHtml = ${JSON.stringify(PERF_WEBPAGE_HTML)};
    for (const node of nodes) {
      const spec = normalize.get(node.id);
      if (!spec) continue;
      node.updatedAt = now;
      if (spec.kind === 'url') {
        node.type = 'iframe';
        node.title = 'perf URL webview ' + node.id;
        node.width = 520;
        node.height = 400;
        node.data = { url: spec.url, mode: 'url', html: '', prompt: '' };
      } else if (spec.kind === 'html') {
        node.type = 'iframe';
        node.title = 'perf HTML page ' + node.id;
        node.width = 520;
        node.height = 400;
        node.data = { url: '', mode: 'html', html: webpageHtml, prompt: '' };
      } else {
        node.type = 'text';
        node.title = 'perf text ' + node.id;
        node.width = 200;
        node.height = 120;
        node.data = { text: 'perf normalized node ' + node.id };
      }
    }
    const specs = ${JSON.stringify(addedSpecs)};
    for (const spec of specs) {
      const gridIndex = ${normalization.normalizedTotal} + spec.ordinal;
      const x = 1400 + (gridIndex % 10) * ${strideX};
      const y = -600 + Math.floor(gridIndex / 10) * ${strideY};
      if (spec.kind === 'url') {
        nodes.push({
          id: spec.id, type: 'iframe', title: 'perf URL webview ' + gridIndex,
          x, y, width: 520, height: 400, updatedAt: now,
          data: { url: spec.url, mode: 'url', html: '', prompt: '' },
        });
      } else if (spec.kind === 'html') {
        nodes.push({
          id: spec.id, type: 'iframe', title: 'perf HTML page ' + gridIndex,
          x, y, width: 520, height: 400, updatedAt: now,
          data: { url: '', mode: 'html', html: webpageHtml, prompt: '' },
        });
      } else {
        nodes.push({
          id: spec.id, type: 'text', title: 'perf ' + gridIndex,
          x, y, width: 200, height: 120, updatedAt: now,
          data: { text: 'perf seed node ' + gridIndex },
        });
      }
    }
    await store.save(wsId, { ...data, nodes });
    return {
      total: nodes.length,
      webpages: nodes.filter((node) => node.type === 'iframe').length,
      urlWebviews: nodes.filter((node) => (
        node.type === 'iframe'
        && node.data?.mode === 'url'
      )).length,
    };
  })()`);
  if (
    persisted.total !== plan.expectedTotal
    || persisted.webpages !== plan.expectedWebpages
    || persisted.urlWebviews !== plan.expectedUrlWebviews
  ) {
    throw new Error(
      `persisted fixture mismatch: ${JSON.stringify(persisted)} expected `
      + `${plan.expectedTotal}/${plan.expectedWebpages}/${plan.expectedUrlWebviews}`,
    );
  }

  await evaluate(cdp, 'location.reload()').catch(() => {});
  await cdp.reconnect();
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(500);
    const rendered = await evaluate(cdp, `(() => ({
      perfReady: !!window.__pulsePerf,
      total: document.querySelectorAll('.canvas-node').length,
      webpages: document.querySelectorAll('.canvas-node--iframe').length,
      urlWebviews: document.querySelectorAll('.canvas-node--iframe webview').length,
    }))()`).catch(() => null);
    if (isRenderedFixtureReady(rendered, plan)) {
      const webviews = expectedUrlWebviews.length > 0
        ? await waitForUrlWebviews(cdp, expectedUrlWebviews)
        : [];
      // A fresh fixture mount can stall the main thread (editor effects,
      // iframe documents, guest processes). Drain it before input scenarios.
      await waitForCalmFrames(cdp);
      return {
        total: persisted.total,
        webpages: persisted.webpages,
        urlWebviews: persisted.urlWebviews,
        webviews,
      };
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
  await cdp.reconnect();

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

const runScenarios = async ({
  seedNodes,
  seedWebpages,
  seedUrlWebviews,
  repeat,
  scenarios: only,
  session,
  fixtureServer,
}) => {
  removeScenarioReportArtifact(outDir);
  if (only.includes('panzoom-trace')) {
    await Promise.all([
      fs.rm(panzoomTracePath, { force: true }),
      fs.rm(panzoomTraceSummaryPath, { force: true }),
    ]);
  }
  const baselines = JSON.parse(await fs.readFile(baselinesPath, 'utf-8'));
  const dictionary = JSON.parse(await fs.readFile(metricsPath, 'utf-8'));
  const scenarios = {};
  let fixture = createScenarioFixtureMetadata({
    seedNodes,
    seedWebpages,
    seedUrlWebviews,
    sessionProfile: session.profile,
  });
  let seededFixture = null;
  let initialWelcomeLocalContentMs = null;
  const executedInteractions = [];
  await fs.mkdir(outDir, { recursive: true });

  await withPage(session, async (cdp) => {
    await cdp.send('Page.bringToFront');
    if (seedNodes > 0 && only.includes('startup')) {
      const captured = await waitFor(
        async () => {
          const value = await readStartupWelcomeLocalContentMs(cdp).catch(() => null);
          return Number.isFinite(value) ? { value } : false;
        },
        10_000,
      ).catch(() => null);
      initialWelcomeLocalContentMs = captured?.value ?? null;
    }
    if (seedNodes > 0) {
      const seeded = await seedExtraNodes({
        cdp,
        count: seedNodes,
        webpageCount: seedWebpages,
        urlWebviewCount: seedUrlWebviews,
        fixtureServer,
      });
      fixture = createScenarioFixtureMetadata({
        seedNodes,
        seedWebpages,
        seedUrlWebviews,
        sessionProfile: session.profile,
        seeded,
      });
      seededFixture = seeded;
      console.log(
        `[perf:scenarios] canvas seeded: ${seeded.total} nodes`
        + (seeded.webpages > 0 ? ` (${seeded.webpages} webpage` : '')
        + (seeded.urlWebviews > 0 ? `, ${seeded.urlWebviews} URL webview` : '')
        + (seeded.webpages > 0 ? ')' : ''),
      );
    }
    if (only.includes('startup')) {
      scenarios.startup = mergeStartupWelcomeEvidence({
        startup: await startupScenario(cdp, session),
        initialWelcomeLocalContentMs,
      });
    }
    if (only.includes('chat-stream')) scenarios['chat-stream'] = await chatStreamScenario(cdp);
    if (only.includes('typing')) {
      scenarios.typing = await typingScenario(cdp, repeat);
      executedInteractions.push('typing');
    }
    if (only.includes('resize')) {
      scenarios.resize = await resizeScenario(cdp, repeat);
      executedInteractions.push('resize');
    }
    if (only.includes('drag')) {
      scenarios.drag = await dragScenario(cdp, repeat);
      executedInteractions.push('drag');
    }
    if (only.includes('zoom-cold')) {
      scenarios['zoom-cold'] = await zoomColdScenario(cdp, repeat);
      executedInteractions.push('zoom-cold');
    }
    if (only.includes('panzoom')) {
      scenarios.panzoom = await panzoomScenario(cdp, repeat);
      executedInteractions.push('panzoom');
    }
    if (only.includes('panzoom-trace')) {
      scenarios['panzoom-trace'] = await panzoomTraceScenario(cdp);
      executedInteractions.push('panzoom-trace');
      await fs.writeFile(
        panzoomTraceSummaryPath,
        JSON.stringify(scenarios['panzoom-trace'], null, 2),
      );
    }
    if (only.includes('zoom-settle')) {
      scenarios['zoom-settle'] = await zoomSettleScenario(cdp, repeat);
      executedInteractions.push('zoom-settle');
    }
    if (only.includes('webview-lifecycle')) {
      scenarios['webview-lifecycle'] = await webviewLifecycleScenario(cdp, seededFixture);
      executedInteractions.push('webview-lifecycle');
    }
    if (only.includes('webview-discard-restore')) {
      scenarios['webview-discard-restore'] = await webviewDiscardRestoreScenario(
        cdp,
        seededFixture,
        session,
      );
      executedInteractions.push('webview-discard-restore');
    }
    if (only.includes('pty-stream')) scenarios['pty-stream'] = await ptyStreamScenario(cdp);
    const stateCheckedAfterScenarios = selectStatePreservationScenarios(executedInteractions);
    if (seededFixture?.webviews?.length > 0 && stateCheckedAfterScenarios.length > 0) {
      const expected = seededFixture.webviews.map(({ id, url }) => ({ id, url }));
      const webviewsAfterInteractions = await waitForUrlWebviews(cdp, expected);
      assertUrlWebviewStatePreserved(seededFixture.webviews, webviewsAfterInteractions);
      fixture = {
        ...fixture,
        statePreserved: true,
        stateCheckedAfterScenarios,
        webviewsAfterInteractions,
      };
    }
    if (only.includes('renderer-trace')) {
      try {
        scenarios['renderer-trace'] = await captureRendererReloadTrace(cdp, {
          expectedNodes: seedNodes || 1,
          headless: !!session.headless,
          rawTracePath: rendererTracePath,
        });
      } catch (err) {
        scenarios['renderer-trace'] = {
          schemaVersion: 1,
          status: 'unavailable',
          reason: err?.message ?? String(err),
          capture: { scope: 'renderer-reload', expectedNodes: seedNodes || 1 },
        };
        console.warn(`[perf:scenarios] renderer trace unavailable: ${scenarios['renderer-trace'].reason}`);
      }
      // captureRendererReloadTrace navigates the page. Its original connection
      // remains dedicated to trace events, so subsequent scenarios need a
      // fresh page socket even when trace capture degrades.
      await cdp.reconnect();
      await fs.writeFile(
        rendererTraceSummaryPath,
        JSON.stringify(scenarios['renderer-trace'], null, 2),
      );
    }
    // image-memory persists ten extra nodes and reloads. Keep it after every
    // N-sensitive interaction and renderer trace so those scenarios measure
    // the requested fixture, not N+10.
    if (only.includes('image-memory')) scenarios['image-memory'] = await imageMemoryScenario(cdp);
    // ws-cycle runs last — it seeds extra workspaces and reloads, so it must
    // not disturb the single-workspace typing/drag/panzoom scenarios above.
    if (only.includes('ws-cycle')) scenarios['ws-cycle'] = await wsCycleScenario(cdp, seedNodes);
  });

  // Aggregate main-process event-loop delay + canvas-save file-write counts
  // from the sampler's log lines (active only when PULSE_CANVAS_PERF=1).
  const stdout = await fs.readFile(session.logFiles.stdout, 'utf-8').catch(() => '');
  const loopDelays = [...stdout.matchAll(/\[perf\] loop-delay (\{.*\})/g)].map((m) => JSON.parse(m[1]));
  const canvasSaves = [...stdout.matchAll(/\[perf\] canvas-save (\{.*\})/g)].map((m) => JSON.parse(m[1]));
  const sessionPersists = [...stdout.matchAll(/\[perf\] session-persist (\{.*\})/g)].map((m) => JSON.parse(m[1]));
  const welcomeWebviews = [...stdout.matchAll(/\[perf\] welcome-webview (\{.*\})/g)].map((m) => JSON.parse(m[1]));
  if (scenarios.startup?.mainPhases && welcomeWebviews.length > 0) {
    const firstLoad = welcomeWebviews[0];
    const openWindowAt = scenarios.startup.mainPhases.openWindow;
    if (typeof firstLoad.at === 'number' && typeof openWindowAt === 'number' && firstLoad.at >= openWindowAt) {
      scenarios.startup.welcomeWebviewMs = firstLoad.at - openWindowAt;
    }
  }
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
    fixtureVersion: RUNTIME_FIXTURE_VERSION,
    repeat,
    session: { id: session.id, profile: session.profile, headless: session.headless === true },
    seedNodes: seedNodes || undefined,
    seedWebpages,
    seedUrlWebviews,
    fixture,
    scenarios,
    gates: gateResults,
  };
  await fs.mkdir(outDir, { recursive: true });
  await fs.writeFile(join(outDir, 'scenarios-report.json'), JSON.stringify(report, null, 2));

  if (scenarios.startup?.mainPhases) {
    console.log('[perf:scenarios] startup phases (ms):', JSON.stringify(scenarios.startup.mainPhases));
  }
  for (const name of ['typing', 'resize', 'drag']) {
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
  const panzoom = scenarios.panzoom;
  if (panzoom) {
    const r = panzoom.report;
    const runsSuffix = r.runs > 1 ? ` (median of ${r.runs} runs, raw=${JSON.stringify(r.raw)})` : '';
    console.log(
      `[perf:scenarios] panzoom: transformChanged=${r.transformChanged === true} `
      + `wheelNextFrameP95=${r.wheelToNextFrame?.p95}ms `
      + `frames>20ms=${r.frames.over20msPct}% max=${r.frames.over20msPctMax ?? r.frames.over20msPct}% `
      + `LoAF=${r.longAnimationFrames.count}/${r.longAnimationFrames.blockingMs}ms${runsSuffix}`,
    );
  }
  const panzoomTrace = scenarios['panzoom-trace'];
  if (panzoomTrace) {
    const gpu = panzoomTrace.summary.byName.GPUTask;
    const raster = panzoomTrace.summary.byName.RasterTask;
    const surface = panzoomTrace.surface.before;
    console.log(
      `[perf:scenarios] panzoom-trace: ${panzoomTrace.status} `
      + `GPU=${gpu.totalMs}ms Raster=${raster.totalMs}ms `
      + `WebViews=${surface.webviewHosts} offscreen=${surface.geometricallyOffscreenWebviews} `
      + `css-hidden=${surface.cssHiddenWebviews} `
      + `viewport=${surface.intersectingViewportWebviews}`,
    );
  }
  const zoomSettle = scenarios['zoom-settle'];
  if (zoomSettle) {
    console.log(
      `[perf:scenarios] zoom-settle: last-wheel-to-rest=${zoomSettle.lastWheelToRestMs}ms `
      + `frames>20ms=${zoomSettle.report.frames.over20msPct}% `
      + `(raw=${JSON.stringify(zoomSettle.rawLastWheelToRestMs)})`,
    );
  }
  const zoomCold = scenarios['zoom-cold'];
  if (zoomCold) {
    const r = zoomCold.report;
    const runsSuffix = r.runs > 1 ? ` (median of ${r.runs} runs, raw=${JSON.stringify(r.raw)})` : '';
    console.log(
      `[perf:scenarios] zoom-cold: coldStartVerified=${r.coldStartVerified === true} `
      + `transformChanged=${r.transformChanged === true} `
      + `firstWheelNextFrame=${r.wheelToNextFrame?.p95}ms `
      + `transformObserved=${r.wheelToPresentedFrame?.transformObservedP95}ms `
      + `firstWheelPresentedFrame=${r.wheelToPresentedFrame?.p95}ms${runsSuffix}`,
    );
  }
  const webviewLifecycle = scenarios['webview-lifecycle'];
  if (webviewLifecycle) {
    console.log(
      `[perf:scenarios] webview-lifecycle: guests=${webviewLifecycle.guests.total} `
      + `offscreen=${webviewLifecycle.guests.offscreen} css-hidden=${webviewLifecycle.guests.cssHidden} `
      + `offscreen rAF/interval=${webviewLifecycle.offscreen.raf}/${webviewLifecycle.offscreen.interval} `
      + `visible+relocate=${webviewLifecycle.visible.raf}/${webviewLifecycle.visible.interval} `
      + `phase-contrast=${webviewLifecycle.phaseContrast.rafReductionPct}%/`
      + `${webviewLifecycle.phaseContrast.intervalReductionPct}% state-preserved=true`,
    );
  }
  const webviewDiscardRestore = scenarios['webview-discard-restore'];
  if (webviewDiscardRestore) {
    console.log(
      `[perf:scenarios] webview-discard-restore: `
      + `${webviewDiscardRestore.before.domGuests}→${webviewDiscardRestore.afterDiscard.domGuests} guests `
      + `(cap=${webviewDiscardRestore.liveCap}, targets=${webviewDiscardRestore.afterDiscard.targetGuests}), `
      + `RSS=${webviewDiscardRestore.before.rssMb ?? 'n/a'}→${webviewDiscardRestore.afterDiscard.rssMb ?? 'n/a'}MB, `
      + `restore=${webviewDiscardRestore.restore.readyMs}ms`,
    );
  }
  const wsc = scenarios['ws-cycle'];
  if (wsc) {
    console.log(
      `[perf:scenarios] ws-cycle: ${wsc.workspaces} workspaces × ${wsc.nodesPerWorkspace} nodes, `
      + `post-capacity heap=${JSON.stringify(wsc.postCapacityHeapsMB)} MB, `
      + `post-capacity slope=${wsc.heapSlopeMB} MB/ws, peak=${wsc.peakHeapMB} MB`,
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
  const ptyStream = scenarios['pty-stream'];
  if (ptyStream) {
    console.log(
      `[perf:scenarios] pty-stream: ${ptyStream.terminals} terminals, `
      + `${ptyStream.events} IPC events / ${ptyStream.durationMs}ms = ${ptyStream.ipcPerSec}/s`,
    );
  }
  const rendererTrace = scenarios['renderer-trace'];
  if (rendererTrace) {
    console.log(
      `[perf:scenarios] renderer-trace: ${rendererTrace.status}`
      + (rendererTrace.status === 'measured'
        ? ` LCP=${rendererTrace.vitals.lcpMs}ms CLS=${rendererTrace.vitals.cls} `
          + `blocking-to-canvas=${rendererTrace.blocking.timeToCanvasMs}ms `
          + `blocking-canvas-to-LCP=${rendererTrace.blocking.timeCanvasToLcpMs}ms `
          + `LongTask=${rendererTrace.blocking.longTaskCount}/${rendererTrace.blocking.longTaskMaxMs}ms`
        : ` (${rendererTrace.reason ?? 'no reason reported'})`),
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
  if (gateResults.some((gate) => !gate.pass)) process.exitCode = 1;
  if (gateResults.length === 0) {
    console.log('[perf:scenarios] record mode: no runtime-scoped policy Gates — use this run to calibrate them.');
  }
};

const main = async (options) => {
  const session = await requireLiveSession();
  assertDisposableFixtureSession(session, options.seedUrlWebviews);
  assertWebviewLifecycleFixture(options.scenarios, options.seedUrlWebviews);
  const fixtureServer = options.seedUrlWebviews > 0 ? await startWebviewFixtureServer() : null;
  try {
    await runScenarios({ ...options, session, fixtureServer });
  } finally {
    await fixtureServer?.close();
  }
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  Promise.resolve()
    .then(() => parseScenarioCliArgs(process.argv.slice(2)))
    .then((options) => main(options))
    .catch((err) => {
      console.error('[perf:scenarios]', err.message ?? err);
      process.exit(2);
    });
}
