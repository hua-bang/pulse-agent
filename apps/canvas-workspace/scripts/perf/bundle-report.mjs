#!/usr/bin/env node
/**
 * Bundle size evaluation: measure the built renderer, ratchet against
 * perf/baselines.json, and emit machine (JSON) + human (HTML) reports.
 *
 *   pnpm --filter canvas-workspace build     # produce dist/
 *   pnpm --filter canvas-workspace perf:bundle
 *
 * Outputs: perf/out/bundle-report.json, perf/out/bundle-report.html
 * Exit 1 when a gated metric exceeds its baseline tolerance.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { renderBundleReportHtml } from './bundle-report-html.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const assetsDir = join(appRoot, 'dist/renderer/assets');
const baselinesPath = join(appRoot, 'perf/baselines.json');
const outDir = join(appRoot, 'perf/out');

// Heuristic, informational-only probes: distinctive strings that indicate a
// heavy library is folded into the eagerly-parsed entry chunk. The hard gates
// are the size ratchets + the static import-graph test (bundle-boundaries).
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

  const baselines = JSON.parse(readFileSync(baselinesPath, 'utf-8')).bundle;
  const current = { entryRawKB: entry.rawKB, entryGzipKB, totalJsKB };
  const gates = Object.entries(baselines).map(([metric, { baseline, tolerancePct }]) => {
    const value = current[metric];
    const limit = Math.round(baseline * (1 + tolerancePct / 100));
    return {
      metric,
      baseline,
      tolerancePct,
      limit,
      current: value,
      deltaPct: Math.round(((value - baseline) / baseline) * 1000) / 10,
      pass: value <= limit,
    };
  });

  const report = {
    generatedAt: new Date().toISOString(),
    commit,
    metrics: { ...current, chunkCount: chunks.length },
    gates,
    probes,
    topChunks: chunks.slice(0, 12),
  };

  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'bundle-report.json'), JSON.stringify(report, null, 2));
  writeFileSync(join(outDir, 'bundle-report.html'), renderBundleReportHtml(report));

  const failed = gates.filter((gate) => !gate.pass);
  for (const gate of gates) {
    const sign = gate.deltaPct > 0 ? '+' : '';
    console.log(
      `[perf:bundle] ${gate.pass ? 'PASS' : 'FAIL'} ${gate.metric}: ${gate.current} KB `
      + `(baseline ${gate.baseline} KB ${sign}${gate.deltaPct}%, limit ${gate.limit} KB)`,
    );
  }
  console.log(`[perf:bundle] report: perf/out/bundle-report.html (${report.metrics.chunkCount} chunks)`);
  if (failed.length > 0) {
    console.error(`[perf:bundle] ${failed.length} gate(s) exceeded baseline — see report`);
    process.exit(1);
  }
};

main();
