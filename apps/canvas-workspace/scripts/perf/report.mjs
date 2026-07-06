#!/usr/bin/env node
/**
 * One-command performance report. Orchestrates the whole pipeline so humans
 * and agents run a single thing:
 *
 *   pnpm --filter canvas-workspace perf:report                # full report
 *   pnpm --filter canvas-workspace perf:report --bundle-only  # fast, no app
 *   pnpm --filter canvas-workspace perf:report --no-build     # reuse dist/
 *   pnpm --filter canvas-workspace perf:report --seed-nodes 300
 *   pnpm --filter canvas-workspace perf:report --seed-webpages 30  # mix in iframe nodes
 *   pnpm --filter canvas-workspace perf:report --repeat 1     # single boot (faster, noisier)
 *
 * Steps: build → bundle gate → (headless harness → runtime scenarios →
 * close) → dashboard. Outputs perf/out/dashboard.html (humans) and
 * perf/out/report.json (agents). Exits 1 if any gate failed.
 *
 * `--repeat N` (A3, default 3): the app is launched N times — the first
 * N-1 boots are startup-only (launch, read the "[perf] startup" phase log,
 * close) and only the Nth stays alive for the interactive scenarios
 * (typing/drag get their own in-session --repeat via run-scenarios.mjs).
 * Startup phases are folded into a same-machine median across all N
 * launches (mergeStartupMedians below) — this is what a single boot cannot
 * do, and is why it lives here rather than in run-scenarios.mjs.
 *
 * Degrades gracefully: if the app can't launch (no Xvfb / Electron binary),
 * runtime scenarios are skipped with a hint and a bundle-only report is
 * still produced.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSession } from '../../harness/src/session.mjs';
import { waitFor } from '../../harness/src/utils.mjs';

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
const seedWebpages = flagValue('--seed-webpages', '0');
const repeat = Math.max(1, Number(flagValue('--repeat', '3')));
const distExists = existsSync(join(appRoot, 'dist/renderer'));

const step = (label) => console.log(`\n\x1b[1m▸ ${label}\x1b[0m`);
const node = (script, scriptArgs = []) =>
  spawnSync(process.execPath, [join(appRoot, script), ...scriptArgs], { cwd: appRoot, stdio: 'inherit' });
const harness = (harnessArgs, extraEnv = {}) =>
  spawnSync(process.execPath, [join(appRoot, 'harness/cli.mjs'), ...harnessArgs], {
    cwd: appRoot,
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
  });

const median = (nums) => {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
};

/** Poll the boot's stdout log for the "[perf] startup {...}" summary line
 *  (written on rendererDomReady — may not exist yet the instant `harness
 *  start` returns, since the CDP page target it waits for can appear before
 *  the page finishes its first paint). */
const readStartupPhases = async (stdoutPath) => {
  try {
    const match = await waitFor(() => {
      const text = existsSync(stdoutPath) ? readFileSync(stdoutPath, 'utf-8') : '';
      return text.match(/\[perf\] startup (\{.*\})/) ?? false;
    }, 8_000);
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
};

// Fold N independent-boot startup samples into a same-machine median so a
// single slow/fast launch can't misfire the dashboard's variance alert.
// Field set is read from the samples themselves (not hardcoded) so it stays
// in sync with whatever startup-metrics.ts actually logs.
const mergeStartupMedians = (samples) => {
  if (samples.length < 2) return;
  const reportPath = join(appRoot, 'perf/out/scenarios-report.json');
  if (!existsSync(reportPath)) return;
  const report = JSON.parse(readFileSync(reportPath, 'utf-8'));
  if (!report.scenarios?.startup) return;
  const fields = new Set(samples.flatMap((s) => Object.keys(s)));
  const raw = {};
  const medians = {};
  for (const field of fields) {
    const values = samples.map((s) => s[field]).filter((v) => typeof v === 'number');
    if (values.length === 0) continue;
    raw[field] = values;
    medians[field] = median(values);
  }
  report.scenarios.startup.mainPhases = medians;
  report.scenarios.startup.mainPhasesRuns = samples.length;
  report.scenarios.startup.mainPhasesRaw = raw;
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
};

let gatesFailed = false;
let scenariosRan = false;

// 1. Build (unless reusing a fresh dist).
if (!noBuild || !distExists) {
  step('构建 renderer(--no-build 可跳过)');
  // A5: PULSE_CANVAS_PERF_ANALYZE=1 turns on entryDepStatsPlugin
  // (electron.vite.config.ts) — reads Rollup's own per-chunk module stats,
  // no extra build work, just an extra JSON write bundle-report.mjs picks
  // up if present.
  const build = spawnSync('pnpm', ['run', 'build'], {
    cwd: appRoot,
    stdio: 'inherit',
    env: { ...process.env, PULSE_CANVAS_PERF_ANALYZE: '1' },
  });
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
  const bootLabel = repeat > 1 ? `×${repeat}(前 ${repeat - 1} 次仅取 startup 样本)` : '×1';
  step(`启动应用(harness, headless, ${bootLabel})`);
  const startupSamples = [];
  let launchFailed = false;
  for (let boot = 0; boot < repeat; boot++) {
    // PULSE_CANVAS_PERF activates the main-process loop-delay sampler + the startup summary log for this run.
    const started = harness(['start', '--profile', 'temp', '--headless', '--force'], { PULSE_CANVAS_PERF: '1' });
    if (started.status !== 0) { launchFailed = true; break; }
    // eslint-disable-next-line no-await-in-loop
    const session = await readSession().catch(() => null);
    // eslint-disable-next-line no-await-in-loop
    const phases = session ? await readStartupPhases(session.logFiles.stdout) : null;
    if (phases) startupSamples.push(phases);
    const isLastBoot = boot === repeat - 1;
    if (!isLastBoot) harness(['close', '--cleanup']);
  }
  if (launchFailed) {
    console.warn(
      '\n[perf:report] 应用启动失败,跳过运行时场景,仅出体积报告。\n'
      + '  无头运行需要 Xvfb(apt-get install -y xvfb)与 Electron 二进制\n'
      + '  (缺失时运行 `pnpm --filter canvas-workspace setup:electron`)。',
    );
  } else {
    try {
      step(
        `运行时场景(打字 / 拖拽 / 启动,@${seedNodes} 节点`
        + (Number(seedWebpages) > 0 ? `(含 ${seedWebpages} 网页)` : '')
        + `,--repeat ${repeat})`,
      );
      if (node('scripts/perf/run-scenarios.mjs', [
        '--seed-nodes', seedNodes,
        '--seed-webpages', seedWebpages,
        '--repeat', String(repeat),
      ]).status !== 0) {
        gatesFailed = true;
      }
      scenariosRan = true;
      mergeStartupMedians(startupSamples);
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
