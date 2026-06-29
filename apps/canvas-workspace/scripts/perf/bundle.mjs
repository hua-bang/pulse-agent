#!/usr/bin/env node
// L1 — Bundle size measurement & budget gate.
//
// Builds the renderer (unless --no-build), measures every emitted JS chunk
// (raw + gzip), identifies the entry chunk from index.html, and heuristically
// detects which heavy dependencies are still bundled into the entry chunk.
// With --check it asserts against perf/budgets.json and exits non-zero on
// regression. With --update it refreshes perf/baselines/bundle.json.
//
// Usage:
//   node scripts/perf/bundle.mjs            # build + report
//   node scripts/perf/bundle.mjs --no-build # measure existing dist/
//   node scripts/perf/bundle.mjs --check    # assert against budgets.json
//   node scripts/perf/bundle.mjs --update   # write baselines/bundle.json

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBytes, gzipSize, readJsonSafe, writeJson, mdTable } from './lib/format.mjs';

const APP_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const RENDERER_DIST = join(APP_ROOT, 'dist', 'renderer');
const OUT = join(APP_ROOT, 'perf', 'out', 'bundle.json');

const args = new Set(process.argv.slice(2));

// Sentinel substrings that betray a heavy dependency living inside a chunk.
// Heuristic but deterministic; good enough to flag "is xterm in the entry?".
// NB: mermaid is intentionally omitted — it is already lazy-loaded via
// chat/utils/mermaid.ts (its library + diagram renderers live in async chunks),
// so a substring check would false-positive on the `import('mermaid')` call
// site that legitimately remains in the entry chunk. These are the deps that
// are genuinely eager and worth splitting (findings C1–C9).
const HEAVY_DEPS = {
  xterm: ['AltClickEnable', 'BufferLine'],
  'react-force-graph-2d': ['forceSimulation', 'd3-force'],
  'lowlight-common': ['highlightAuto', 'createLowlight'],
  '@tiptap/ProseMirror': ['ProseMirror', 'prosemirror'],
  'markdown-it': ['MarkdownIt'],
  '@module-federation/runtime': ['__FEDERATION__', 'module-federation'],
};

const build = () => {
  if (args.has('--no-build')) return;
  process.stderr.write('› building renderer (electron-vite build)…\n');
  execFileSync('npx', ['electron-vite', 'build'], {
    cwd: APP_ROOT,
    stdio: 'inherit',
    env: { ...process.env, PULSE_PERF_BUNDLE: '1' },
  });
};

const findEntryChunk = (assetFiles) => {
  const indexHtml = join(RENDERER_DIST, 'index.html');
  if (existsSync(indexHtml)) {
    const html = readFileSync(indexHtml, 'utf-8');
    const match = html.match(/src="[^"]*assets\/([^"]+\.js)"/);
    if (match) {
      const name = match[1];
      const hit = assetFiles.find((f) => f.endsWith(name));
      if (hit) return hit;
    }
  }
  // Fallback: largest chunk is almost certainly the entry.
  return assetFiles.slice().sort((a, b) => sizeOf(b) - sizeOf(a))[0];
};

const sizeOf = (path) => readFileSync(path).length;

const measure = () => {
  const assetsDir = join(RENDERER_DIST, 'assets');
  if (!existsSync(assetsDir)) {
    throw new Error(`no renderer build found at ${assetsDir} — run without --no-build`);
  }
  const files = readdirSync(assetsDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => join(assetsDir, f));

  const chunks = files.map((path) => {
    const buf = readFileSync(path);
    return { name: path.slice(assetsDir.length + 1), rawBytes: buf.length, gzipBytes: gzipSize(buf) };
  });

  const entryPath = findEntryChunk(files);
  const entryName = entryPath.slice(assetsDir.length + 1);
  const entryText = readFileSync(entryPath, 'utf-8');

  const heavyDepInEntry = {};
  for (const [dep, sentinels] of Object.entries(HEAVY_DEPS)) {
    heavyDepInEntry[dep] = sentinels.some((s) => entryText.includes(s));
  }

  const entry = chunks.find((c) => c.name === entryName);
  return {
    generatedAt: new Date().toISOString(),
    entryChunk: entryName,
    entryRawBytes: entry?.rawBytes ?? 0,
    entryGzipBytes: entry?.gzipBytes ?? 0,
    totalRawBytes: chunks.reduce((a, c) => a + c.rawBytes, 0),
    totalGzipBytes: chunks.reduce((a, c) => a + c.gzipBytes, 0),
    asyncChunkCount: chunks.length - 1,
    chunkCount: chunks.length,
    heavyDepInEntry,
    chunks: chunks.sort((a, b) => b.gzipBytes - a.gzipBytes),
  };
};

const printReport = (r) => {
  process.stdout.write(`\nEntry chunk: ${r.entryChunk}\n`);
  process.stdout.write(`  raw ${formatBytes(r.entryRawBytes)} · gzip ${formatBytes(r.entryGzipBytes)}\n`);
  process.stdout.write(`Total: raw ${formatBytes(r.totalRawBytes)} · gzip ${formatBytes(r.totalGzipBytes)} across ${r.chunkCount} chunks (${r.asyncChunkCount} async)\n\n`);
  process.stdout.write('Heavy deps in entry chunk:\n');
  for (const [dep, present] of Object.entries(r.heavyDepInEntry)) {
    process.stdout.write(`  ${present ? '✗' : '✓'} ${dep}${present ? ' (in entry)' : ''}\n`);
  }
  process.stdout.write('\nTop chunks by gzip:\n');
  process.stdout.write(`${mdTable(['chunk', 'raw', 'gzip'], r.chunks.slice(0, 8).map((c) => [c.name, formatBytes(c.rawBytes), formatBytes(c.gzipBytes)]))}\n`);
};

const check = (r) => {
  const budgets = readJsonSafe(join(APP_ROOT, 'perf', 'budgets.json'));
  if (!budgets) {
    process.stderr.write('⚠ no perf/budgets.json — skipping --check (run --update to seed a baseline)\n');
    return 0;
  }
  const failures = [];
  const eg = budgets.entryChunkGzipBytes;
  if (eg?.max != null && r.entryGzipBytes > eg.max) {
    failures.push(`entry gzip ${formatBytes(r.entryGzipBytes)} > budget ${formatBytes(eg.max)}`);
  }
  for (const [dep, allowed] of Object.entries(budgets.heavyDepInEntry ?? {})) {
    if (allowed === false && r.heavyDepInEntry[dep]) {
      failures.push(`heavy dep "${dep}" must not be in entry chunk`);
    }
  }
  if (failures.length) {
    process.stderr.write(`\n✗ bundle budget check failed:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`);
    return 1;
  }
  process.stdout.write('\n✓ bundle within budget\n');
  return 0;
};

build();
const report = measure();
writeJson(OUT, report);
printReport(report);
if (args.has('--update')) {
  writeJson(join(APP_ROOT, 'perf', 'baselines', 'bundle.json'), report);
  process.stdout.write('\n✓ wrote perf/baselines/bundle.json\n');
}
process.exit(args.has('--check') ? check(report) : 0);
