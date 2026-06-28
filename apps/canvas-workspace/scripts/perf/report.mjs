#!/usr/bin/env node
// One-command performance snapshot orchestrator.
//
// Runs each measurable layer, then aggregates every perf/out/*.json into a
// single human-readable perf/out/perf-snapshot.md plus perf-snapshot.json.
// Each layer is optional and isolated: a layer whose deps are missing or that
// fails is recorded as failed/skipped, and the snapshot is still produced from
// whatever ran.
//
// Usage:
//   node scripts/perf/report.mjs                 # bundle + bench
//   node scripts/perf/report.mjs --no-build      # skip the renderer build
//   node scripts/perf/report.mjs --with-runtime  # also attempt L3/L4 (harness)

import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatBytes, readJsonSafe, writeJson, writeText, mdTable, ensureDir } from './lib/format.mjs';

const APP_ROOT = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const OUT_DIR = join(APP_ROOT, 'perf', 'out');
const args = new Set(process.argv.slice(2));

ensureDir(OUT_DIR);

const runStep = (label, cmd, cmdArgs) => {
  process.stderr.write(`\n━━ ${label} ━━\n`);
  const start = Date.now();
  const res = spawnSync(cmd, cmdArgs, { cwd: APP_ROOT, stdio: 'inherit', env: process.env });
  const durationMs = Date.now() - start;
  const status = res.status === 0 ? 'ok' : res.error ? 'error' : 'failed';
  return { label, status, durationMs, code: res.status ?? null, error: res.error?.message ?? null };
};

const steps = [];

// L1 — bundle
steps.push(
  runStep(
    'L1 bundle',
    'node',
    ['scripts/perf/bundle.mjs', ...(args.has('--no-build') ? ['--no-build'] : [])],
  ),
);

// L2 — benchmarks
steps.push(
  runStep('L2 bench', 'npx', [
    'vitest',
    'bench',
    '--run',
    '--config',
    'vitest.bench.config.ts',
    '--outputJson',
    'perf/out/bench.json',
  ]),
);

// L3/L4 — runtime (harness). Not yet wired; record as skipped unless present.
if (args.has('--with-runtime')) {
  steps.push(runStep('L3 startup', 'node', ['./harness/cli.mjs', 'perf-startup', '--runs', '5']));
  steps.push(runStep('L4 runtime', 'node', ['./harness/cli.mjs', 'perf-runtime', '--scenario', 'all']));
} else {
  steps.push({ label: 'L3 startup', status: 'skipped', durationMs: 0, note: 'pass --with-runtime' });
  steps.push({ label: 'L4 runtime', status: 'skipped', durationMs: 0, note: 'pass --with-runtime' });
}

// ── Aggregate ──────────────────────────────────────────────────────────────
const bundle = readJsonSafe(join(OUT_DIR, 'bundle.json'));
const benchRaw = readJsonSafe(join(OUT_DIR, 'bench.json'));
const startup = readJsonSafe(join(OUT_DIR, 'startup.json'));
const runtime = readJsonSafe(join(OUT_DIR, 'runtime.json'));

// Vitest's bench JSON shape varies across versions; walk it generically and
// collect every {name, mean|hz} pair with its group path.
const collectBenches = (node, group, acc) => {
  if (!node || typeof node !== 'object') return acc;
  if (Array.isArray(node)) {
    for (const item of node) collectBenches(item, group, acc);
    return acc;
  }
  const hasResult = typeof node.name === 'string' && (typeof node.mean === 'number' || typeof node.hz === 'number');
  if (hasResult) {
    acc.push({ group, name: node.name, mean: node.mean ?? null, hz: node.hz ?? null });
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'name' || key === 'mean' || key === 'hz') continue;
    const nextGroup = typeof node.name === 'string' && (node.groups || node.benchmarks || node.tests) ? node.name : group;
    collectBenches(value, nextGroup, acc);
  }
  return acc;
};
const benches = benchRaw ? collectBenches(benchRaw, '', []) : [];

const statusIcon = (s) => (s === 'ok' ? '✓' : s === 'skipped' ? '–' : '✗');

let md = '';
md += '# Canvas Workspace 性能快照\n\n';
md += `> 生成于 ${new Date().toISOString()} · 由 \`pnpm --filter canvas-workspace perf:report\` 产出。\n`;
md += '> 对应发现见 `docs/performance-analysis-consolidated.md`,基建设计见 `docs/perf-infra-design.md`。\n\n';

md += '## 运行状态\n\n';
md += `${mdTable(
  ['层', '状态', '耗时'],
  steps.map((s) => [s.label, `${statusIcon(s.status)} ${s.status}${s.note ? ` (${s.note})` : ''}`, s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : '—']),
)}\n\n`;

md += '## L1 · 前端资源 (bundle)\n\n';
if (bundle) {
  md += `- 启动 chunk \`${bundle.entryChunk}\`:raw **${formatBytes(bundle.entryRawBytes)}** · gzip **${formatBytes(bundle.entryGzipBytes)}**\n`;
  md += `- 总计:raw ${formatBytes(bundle.totalRawBytes)} · gzip ${formatBytes(bundle.totalGzipBytes)},共 ${bundle.chunkCount} chunk(${bundle.asyncChunkCount} async)\n\n`;
  md += '**重依赖是否落进启动 chunk**(对应 C1–C9):\n\n';
  md += `${mdTable(['依赖', '在启动 chunk'], Object.entries(bundle.heavyDepInEntry).map(([d, p]) => [d, p ? '✗ 是' : '✓ 否']))}\n\n`;
  md += '**Top chunks (gzip)**:\n\n';
  md += `${mdTable(['chunk', 'raw', 'gzip'], bundle.chunks.slice(0, 8).map((c) => [c.name, formatBytes(c.rawBytes), formatBytes(c.gzipBytes)]))}\n\n`;
} else {
  md += '_未产出 bundle.json — L1 未运行或构建失败。_\n\n';
}

md += '## L2 · 热函数微基准 (运行时算法成本)\n\n';
if (benches.length) {
  md += '> 绝对 ms 受机器影响,价值在同机 before/after 比值与随 N 的增长曲线(暴露 O(n²))。对应 A3 等算法发现。\n\n';
  md += `${mdTable(
    ['基准', 'group', 'mean (ms)', 'ops/s'],
    benches.map((b) => [b.name, b.group || '—', b.mean != null ? b.mean.toFixed(4) : '—', b.hz != null ? Math.round(b.hz).toString() : '—']),
  )}\n\n`;
} else {
  md += '_未产出 bench 结果 — L2 未运行或依赖缺失。_\n\n';
}

md += '## L3 · 启动 / time-to-window\n\n';
md += startup ? `${'```json\n'}${JSON.stringify(startup, null, 2)}\n${'```'}\n\n` : '_未运行(需 `--with-runtime` + harness 打点,见设计文档 L3)。_\n\n';

md += '## L4 · 运行时 profiling\n\n';
md += runtime ? `${'```json\n'}${JSON.stringify(runtime, null, 2)}\n${'```'}\n\n` : '_未运行(需 `--with-runtime` + harness 场景,见设计文档 L4)。_\n\n';

md += '---\n\n';
md += '将以上实测值回填到 `performance-analysis-consolidated.md` 的"估算"列,即可把静态推断升级为实测并据此重排优先级。\n';

writeText(join(OUT_DIR, 'perf-snapshot.md'), md);
writeJson(join(OUT_DIR, 'perf-snapshot.json'), {
  generatedAt: new Date().toISOString(),
  steps,
  bundle,
  benches,
  startup,
  runtime,
});

process.stderr.write(`\n✓ snapshot → perf/out/perf-snapshot.md\n`);
const hardFailed = steps.some((s) => s.status === 'failed' || s.status === 'error');
process.exit(hardFailed ? 1 : 0);
