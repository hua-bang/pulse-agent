#!/usr/bin/env node
/**
 * One-command performance report. Orchestrates the whole pipeline so humans
 * and agents run a single thing:
 *
 *   pnpm --filter canvas-workspace perf:report                # full report
 *   pnpm --filter canvas-workspace perf:report --bundle-only  # fast, no app
 *   pnpm --filter canvas-workspace perf:report --no-build     # reuse dist/
 *   pnpm --filter canvas-workspace perf:report --seed-nodes 300
 *
 * Steps: build → bundle gate → (headless harness → runtime scenarios →
 * close) → dashboard. Outputs perf/out/dashboard.html (humans) and
 * perf/out/report.json (agents). Exits 1 if any gate failed.
 *
 * Degrades gracefully: if the app can't launch (no Xvfb / Electron binary),
 * runtime scenarios are skipped with a hint and a bundle-only report is
 * still produced.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const flagValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const bundleOnly = has('--bundle-only');
const noBuild = has('--no-build');
const seedNodes = flagValue('--seed-nodes', '100');
const distExists = existsSync(join(appRoot, 'dist/renderer'));

const step = (label) => console.log(`\n\x1b[1m▸ ${label}\x1b[0m`);
const node = (script, scriptArgs = []) =>
  spawnSync(process.execPath, [join(appRoot, script), ...scriptArgs], { cwd: appRoot, stdio: 'inherit' });
const harness = (harnessArgs) =>
  spawnSync(process.execPath, [join(appRoot, 'harness/cli.mjs'), ...harnessArgs], { cwd: appRoot, stdio: 'inherit' });

let gatesFailed = false;
let scenariosRan = false;

// 1. Build (unless reusing a fresh dist).
if (!noBuild || !distExists) {
  step('构建 renderer(--no-build 可跳过)');
  const build = spawnSync('pnpm', ['run', 'build'], { cwd: appRoot, stdio: 'inherit' });
  if (build.status !== 0) {
    console.error('[perf:report] build failed — aborting.');
    process.exit(2);
  }
}

// 2. Bundle gate (never aborts — we want the report even on regression).
step('体积门禁(perf:bundle)');
if (node('scripts/perf/bundle-report.mjs').status !== 0) gatesFailed = true;

// 3. Runtime scenarios via a self-managed headless harness session.
if (!bundleOnly) {
  step('启动应用(harness, headless)');
  const started = harness(['start', '--profile', 'temp', '--headless', '--force']);
  if (started.status !== 0) {
    console.warn(
      '\n[perf:report] 应用启动失败,跳过运行时场景,仅出体积报告。\n'
      + '  无头运行需要 Xvfb(apt-get install -y xvfb)与 Electron 二进制\n'
      + '  (缺失时运行 `pnpm --filter canvas-workspace setup:electron`)。',
    );
  } else {
    try {
      step(`运行时场景(打字 / 拖拽 / 启动,@${seedNodes} 节点)`);
      if (node('scripts/perf/run-scenarios.mjs', ['--seed-nodes', seedNodes]).status !== 0) gatesFailed = true;
      scenariosRan = true;
    } finally {
      step('关闭应用');
      harness(['close', '--cleanup']);
    }
  }
}

// 4. Assemble the report.
step('生成报告(perf:dashboard)');
if (node('scripts/perf/dashboard.mjs').status !== 0) gatesFailed = true;

// 5. Summary.
const reportPath = join(appRoot, 'perf/out/report.json');
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf-8')) : null;
console.log('\n\x1b[1m─ 性能报告 ─────────────────────────\x1b[0m');
if (report) {
  console.log(`结论: ${report.verdict}`);
  const high = report.alerts.filter((a) => a.severity === 'high');
  const medium = report.alerts.filter((a) => a.severity === 'medium');
  if (high.length) console.log(`⚠ HIGH ×${high.length}: ${high.map((a) => a.title).join(' / ')}`);
  if (medium.length) console.log(`  MED  ×${medium.length}: ${medium.map((a) => a.title).join(' / ')}`);
  console.log(`覆盖: ${report.coverage.measured}/${report.coverage.total} 指标${scenariosRan ? '' : ' · 仅体积(运行时场景已跳过)'}`);
}
console.log('看板: apps/canvas-workspace/perf/out/dashboard.html');
console.log('契约: apps/canvas-workspace/perf/out/report.json');

process.exit(gatesFailed ? 1 : 0);
