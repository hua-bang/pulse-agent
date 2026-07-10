#!/usr/bin/env node
/**
 * Bundle evaluation: measure the built renderer, evaluate every bundle-scoped
 * policy Gate in perf/baselines.json, and emit machine (JSON) + human reports.
 *
 *   pnpm --filter canvas-workspace build     # produce dist/
 *   pnpm --filter canvas-workspace perf:bundle
 *
 * Outputs: perf/out/bundle-report.json, perf/out/bundle-report.html
 * Exit 1 when any bundle policy Gate fails.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { buildBundleGates } from './bundle-gates.mjs';
import { renderBundleReportHtml } from './bundle-report-html.mjs';
import { validatePerformancePolicies } from './metric-policy.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const assetsDir = join(appRoot, 'dist/renderer/assets');
const baselinesPath = join(appRoot, 'perf/baselines.json');
const metricsPath = join(appRoot, 'perf/metrics.json');
const outDir = join(appRoot, 'perf/out');
const depStatsPath = join(outDir, 'entry-dep-stats.json');

// Built-output probes: distinctive strings that indicate a heavy library is
// folded into the eagerly-parsed entry chunk. Together they drive the
// bundle.lazy_boundary_watchlist boolean Gate; the source-level import graph
// test remains a second, independent guard.
const ENTRY_PROBES = [
  { lib: 'xterm', probe: 'xterm-helper-textarea' },
  // 'prosemirror-view' survives minification (package-name string inside the
  // lib); a bare 'ProseMirror' probe false-positives on the DOM-selector
  // string '.ProseMirror' that entry-resident canvas handlers use.
  { lib: 'tiptap/prosemirror', probe: 'prosemirror-view' },
  { lib: 'highlight.js', probe: 'did you forget to load/include a language module' },
  { lib: 'force-graph (d3-force)', probe: 'velocityDecay' },
  { lib: 'module-federation runtime', probe: '__FEDERATION__' },
  { lib: 'mermaid (must stay lazy)', probe: 'flowchart-elk' },
];

const kb = (bytes) => Math.round(bytes / 1024);

const main = () => {
  if (!existsSync(assetsDir)) {
    console.error(`[perf:bundle] missing ${assetsDir}\nRun: pnpm --filter canvas-workspace build`);
    process.exit(2);
  }

  const chunks = readdirSync(assetsDir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => {
      const raw = statSync(join(assetsDir, name)).size;
      return { name, rawKB: kb(raw) };
    })
    .sort((a, b) => b.rawKB - a.rawKB);

  const entry = chunks.find((chunk) => chunk.name.startsWith('index-'));
  if (!entry) {
    console.error('[perf:bundle] no index-*.js entry chunk found');
    process.exit(2);
  }
  const entrySource = readFileSync(join(assetsDir, entry.name), 'utf-8');
  const entryGzipKB = kb(gzipSync(Buffer.from(entrySource)).length);
  const totalJsKB = chunks.reduce((sum, chunk) => sum + chunk.rawKB, 0);

  const probes = ENTRY_PROBES.map(({ lib, probe }) => ({
    lib,
    inEntry: entrySource.includes(probe),
  }));

  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: appRoot, encoding: 'utf-8' }).trim();
  } catch {
    /* not a git checkout — fine */
  }

  const baselines = JSON.parse(readFileSync(baselinesPath, 'utf-8'));
  const dictionary = JSON.parse(readFileSync(metricsPath, 'utf-8'));
  const policyErrors = validatePerformancePolicies(dictionary, baselines);
  if (policyErrors.length > 0) {
    console.error(`[perf:bundle] invalid performance policy:\n- ${policyErrors.join('\n- ')}`);
    process.exit(2);
  }
  const current = {
    entryRawKB: entry.rawKB,
    entryGzipKB,
    totalJsKB,
    lazyBoundaryWatchlist: probes.every((probe) => !probe.inEntry),
  };
  const gates = buildBundleGates(baselines, current);

  // A5: per-dependency attribution inside the entry chunk. Only present
  // when the build ran with PULSE_CANVAS_PERF_ANALYZE=1 (electron.vite.config.ts's
  // entryDepStatsPlugin) — absent otherwise, so a plain `pnpm build` +
  // `perf:bundle` still works without this section (D2's treemap tab
  // renders it as 未建 when missing, same convention as every other
  // not-yet-instrumented metric).
  let entryDepAttribution = null;
  if (existsSync(depStatsPath)) {
    const stats = JSON.parse(readFileSync(depStatsPath, 'utf-8'));
    const deps = Object.entries(stats.byPackage ?? {})
      .map(([pkg, bytes]) => ({ pkg, rawKB: kb(bytes) }))
      .filter((d) => d.rawKB > 0)
      .sort((a, b) => b.rawKB - a.rawKB);
    entryDepAttribution = {
      chunkFileName: stats.chunkFileName,
      appOwnKB: kb(stats.appOwnBytes ?? 0),
      deps,
    };
  }

  const report = {
    generatedAt: new Date().toISOString(),
    commit,
    metrics: { ...current, chunkCount: chunks.length },
    gates,
    probes,
    topChunks: chunks.slice(0, 12),
    entryDepAttribution,
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'bundle-report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, 'bundle-report.html'), renderBundleReportHtml(report));

  const failed = gates.filter((gate) => !gate.pass);
  for (const gate of gates) {
    if (gate.kind === 'true') {
      console.log(
        `[perf:bundle] ${gate.pass ? 'PASS' : 'FAIL'} ${gate.metric}: ${String(gate.current)} (required true)`,
      );
      continue;
    }
    const sign = gate.deltaPct > 0 ? '+' : '';
    console.log(
      `[perf:bundle] ${gate.pass ? 'PASS' : 'FAIL'} ${gate.metric}: ${gate.current} KB `
      + `(baseline ${gate.baseline} KB ${sign}${gate.deltaPct}%, limit ${gate.limit} KB)`,
    );
  }
  if (entryDepAttribution) {
    const top = entryDepAttribution.deps.slice(0, 5).map((d) => `${d.pkg} ${d.rawKB}KB`).join(' · ');
    console.log(`[perf:bundle] entry attribution: app ${entryDepAttribution.appOwnKB}KB · ${top}`);
  }
  console.log(`[perf:bundle] report: perf/out/bundle-report.html (${report.metrics.chunkCount} chunks)`);
  if (failed.length > 0) {
    console.error(`[perf:bundle] ${failed.length} gate(s) exceeded baseline — see report`);
    process.exit(1);
  }
};

main();
