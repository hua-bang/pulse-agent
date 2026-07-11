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
import { buildBundleGates } from './bundle-gates.mjs';
import {
  matchesEntryDepStats,
  measureManifestClosure,
  measureRendererBundle,
} from './bundle-measurements.mjs';
import { renderBundleReportHtml } from './bundle-report-html.mjs';
import { validatePerformancePolicies } from './metric-policy.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const rendererDir = join(appRoot, 'dist/renderer');
const assetsDir = join(appRoot, 'dist/renderer/assets');
const manifestPath = join(rendererDir, 'manifest.json');
const baselinesPath = join(appRoot, 'perf/baselines.json');
const metricsPath = join(appRoot, 'perf/metrics.json');
const outDir = join(appRoot, 'perf/out');
const depStatsPath = join(outDir, 'entry-dep-stats.json');
const mainBundlePath = join(appRoot, 'dist/main/index.js');
const preloadBundlePath = join(appRoot, 'dist/preload/index.js');

// Rollup module IDs are the source of truth for heavy libraries in the entry.
// This remains stable under minification and cannot false-positive on strings
// that merely resemble a library implementation detail.
const ENTRY_MODULE_WATCHLIST = [
  { lib: 'xterm', matches: /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?@xterm\// },
  { lib: 'tiptap/prosemirror', matches: /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:@tiptap\/|prosemirror-)/ },
  { lib: 'highlight.js', matches: /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:highlight\.js|lowlight)\// },
  { lib: 'force-graph (d3-force)', matches: /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(?:react-force-graph|force-graph|d3-force)(?:@|\/)/ },
  { lib: 'module-federation runtime', matches: /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?@module-federation\// },
  { lib: 'mermaid (must stay lazy)', matches: /\/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?mermaid\// },
];

const FEATURE_ENTRIES = [
  { id: 'file', matches: (key) => key.endsWith('src/components/FileNodeBody/index.tsx') },
  { id: 'chat', matches: (key) => key.endsWith('src/components/chat/ChatPanel.tsx') },
  { id: 'terminal', matches: (key) => key.endsWith('src/components/TerminalNodeBody/index.tsx') },
  { id: 'graph', matches: (key) => key.endsWith('src/components/WorkspaceNodes/GraphPage.tsx') },
  { id: 'mermaid', matches: (_key, chunk) => /^assets\/mermaid\.core-/.test(chunk.file ?? '') },
  { id: 'mf', matches: (key) => key.includes('/@module-federation+runtime@') && key.endsWith('/dist/index.js') },
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

  if (!existsSync(manifestPath)) {
    console.error(`[perf:bundle] missing ${manifestPath}\nRun the build with PULSE_CANVAS_PERF_ANALYZE=1`);
    process.exit(2);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const measured = measureRendererBundle({ rendererDir, manifest });
  const measuredEntryName = measured.entry.file.split('/').pop();
  const entry = chunks.find((chunk) => chunk.name === measuredEntryName);
  if (!entry) {
    console.error('[perf:bundle] no index-*.js entry chunk found');
    process.exit(2);
  }
  const entryGzipKB = kb(measured.entry.gzipBytes);
  const totalJsKB = kb(measured.total.jsRawBytes);
  const startupFiles = [...measured.startup.jsFiles, ...measured.startup.cssFiles];
  const featureFirstLoad = Object.fromEntries(FEATURE_ENTRIES.map((feature) => {
    const matches = Object.entries(manifest)
      .filter(([key, chunk]) => feature.matches(key, chunk))
      .map(([key]) => key);
    if (matches.length !== 1) {
      throw new Error(`expected exactly one manifest entry for feature ${feature.id}, found ${matches.length}`);
    }
    const closure = measureManifestClosure({
      rendererDir,
      manifest,
      entryKey: matches[0],
      excludeFiles: startupFiles,
    });
    return [feature.id, {
      rawKB: kb(closure.rawBytes),
      requestCount: closure.requestCount,
      jsFiles: closure.jsFiles,
      cssFiles: closure.cssFiles,
    }];
  }));

  if (!existsSync(depStatsPath)) {
    console.error(`[perf:bundle] missing ${depStatsPath}\nRebuild with PULSE_CANVAS_PERF_ANALYZE=1`);
    process.exit(2);
  }
  const stats = JSON.parse(readFileSync(depStatsPath, 'utf-8'));
  if (!matchesEntryDepStats(stats, measured.entry) || !Array.isArray(stats.moduleIds)) {
    console.error('[perf:bundle] entry dependency graph is stale or incomplete; rebuild with PULSE_CANVAS_PERF_ANALYZE=1');
    process.exit(2);
  }
  const probes = ENTRY_MODULE_WATCHLIST.map(({ lib, matches }) => ({
    lib,
    inEntry: stats.moduleIds.some((moduleId) => matches.test(moduleId)),
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
    entryRawKB: kb(measured.entry.rawBytes),
    entryGzipKB,
    totalJsKB,
    lazyBoundaryWatchlist: probes.every((probe) => !probe.inEntry),
    startupJsRawKB: kb(measured.startup.jsRawBytes),
    startupJsGzipKB: kb(measured.startup.jsGzipBytes),
    startupCssRawKB: kb(measured.startup.cssRawBytes),
    startupCssGzipKB: kb(measured.startup.cssGzipBytes),
    startupRequestCount: measured.startup.requestCount,
    totalCssRawKB: kb(measured.total.cssRawBytes),
    featureFirstLoad,
    ...(existsSync(mainBundlePath) ? { mainRawKB: kb(statSync(mainBundlePath).size) } : {}),
    ...(existsSync(preloadBundlePath) ? { preloadRawKB: kb(statSync(preloadBundlePath).size) } : {}),
  };
  const gates = buildBundleGates(baselines, current);

  // A5: per-dependency attribution inside the entry chunk. Only present
  // when the build ran with PULSE_CANVAS_PERF_ANALYZE=1 (electron.vite.config.ts's
  // entryDepStatsPlugin) — absent otherwise, so a plain `pnpm build` +
  // `perf:bundle` still works without this section (D2's treemap tab
  // renders it as 未建 when missing, same convention as every other
  // not-yet-instrumented metric).
  const entryDepAttribution = {
    chunkFileName: stats.chunkFileName,
    appOwnKB: kb(stats.appOwnBytes ?? 0),
    deps: Object.entries(stats.byPackage ?? {})
      .map(([pkg, bytes]) => ({ pkg, rawKB: kb(bytes) }))
      .filter((dep) => dep.rawKB > 0)
      .sort((a, b) => b.rawKB - a.rawKB),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    commit,
    metrics: { ...current, chunkCount: measured.total.jsFiles.length },
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
