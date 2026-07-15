#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cwd = process.cwd();
const repoRoot = process.env.PULSE_CODER_REPO_ROOT
  ? resolve(process.env.PULSE_CODER_REPO_ROOT)
  : existsSync(join(cwd, 'apps/canvas-workspace/package.json'))
    ? cwd
    : resolve(skillDir, '../../..');
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag, fallback) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const repeat = valueOf('--repeat', process.env.PULSE_CANVAS_PERF_REPEAT || '1');
const seedNodes = valueOf('--seed-nodes', process.env.PULSE_CANVAS_PERF_SEED_NODES || '100');
const seedWebpages = valueOf(
  '--seed-webpages',
  process.env.PULSE_CANVAS_PERF_SEED_WEBPAGES || '0',
);
const seedUrlWebviews = valueOf(
  '--seed-url-webviews',
  process.env.PULSE_CANVAS_PERF_SEED_URL_WEBVIEWS || '0',
);
const startupScreenshot = process.env.PULSE_CANVAS_PERF_STARTUP_SCREENSHOT
  || join(repoRoot, 'apps/canvas-workspace/perf/out/electron-startup.png');
const skipBuild = has('--no-build');
const strict = has('--strict');

const run = (label, command, commandArgs, options = {}) => {
  console.log(`\n[perf-report] ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_OPTIONS: process.env.NODE_OPTIONS || '--max-old-space-size=1024',
      ...(options.env || {}),
    },
    timeout: options.timeout || 900_000,
  });
  return result.status ?? 1;
};

if (!skipBuild) {
  const buildStatus = run('build canvas-workspace', 'pnpm', ['--filter', 'canvas-workspace', 'build']);
  if (buildStatus !== 0) process.exit(buildStatus);
}

const perfArgs = [
  '--filter', 'canvas-workspace', 'perf:report', '--no-build',
  '--repeat', repeat,
  '--seed-nodes', seedNodes,
  '--seed-webpages', seedWebpages,
  '--seed-url-webviews', seedUrlWebviews,
];
const perfStatus = run('run performance report', 'pnpm', perfArgs, {
  timeout: 900_000,
  env: { PULSE_CANVAS_PERF_STARTUP_SCREENSHOT: startupScreenshot },
});
const dashboardPath = join(repoRoot, 'apps/canvas-workspace/perf/out/dashboard.html');
if (perfStatus !== 0 && !existsSync(dashboardPath)) {
  process.exit(perfStatus);
}

const publishStatus = run('publish dashboard and capture screenshot', process.execPath, [
  join(skillDir, 'scripts/publish-dashboard.mjs'),
  ...(has('--no-screenshot') ? ['--no-screenshot'] : []),
], { timeout: 120_000 });

if (publishStatus !== 0) process.exit(publishStatus);
if (strict && perfStatus !== 0) process.exit(perfStatus);
process.exit(0);
