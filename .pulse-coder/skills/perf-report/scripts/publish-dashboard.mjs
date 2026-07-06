#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cwd = process.cwd();
const repoRoot = process.env.PULSE_CODER_REPO_ROOT
  ? resolve(process.env.PULSE_CODER_REPO_ROOT)
  : existsSync(join(cwd, 'apps/canvas-workspace/package.json'))
    ? cwd
    : resolve(skillDir, '../../..');
const outDir = join(repoRoot, 'apps/canvas-workspace/perf/out');
const deployDir = process.env.PULSE_CANVAS_PERF_DEPLOY_DIR || '/data/www/sites/default/current/canvas-perf';
const publicUrl = process.env.PULSE_CANVAS_PERF_PUBLIC_URL || 'https://jasperhu.art/apps/canvas-perf/';
const screenshotPath = resolve(
  process.env.PULSE_CANVAS_PERF_SCREENSHOT || join(outDir, 'dashboard.png'),
);
const startupScreenshotPath = resolve(
  process.env.PULSE_CANVAS_PERF_STARTUP_SCREENSHOT || join(outDir, 'electron-startup.png'),
);
const args = process.argv.slice(2);
const noScreenshot = args.includes('--no-screenshot');

const required = ['dashboard.html', 'report.json'];
for (const file of required) {
  const path = join(outDir, file);
  if (!existsSync(path)) {
    console.error(`[perf-report] missing ${path}; run perf:report first.`);
    process.exit(2);
  }
}

mkdirSync(deployDir, { recursive: true });
copyFileSync(join(outDir, 'dashboard.html'), join(deployDir, 'index.html'));
for (const file of ['report.json', 'scenarios-report.json', 'bundle-report.json']) {
  const source = join(outDir, file);
  if (existsSync(source)) copyFileSync(source, join(deployDir, file));
}
if (existsSync(startupScreenshotPath)) {
  copyFileSync(startupScreenshotPath, join(deployDir, 'electron-startup.png'));
}

const result = {
  ok: true,
  deployed: {
    url: publicUrl,
    dir: deployDir,
    index: join(deployDir, 'index.html'),
  },
  screenshot: null,
  startupScreenshot: existsSync(startupScreenshotPath)
    ? {
        ok: true,
        outputPath: startupScreenshotPath,
        mimeType: 'image/png',
        bytes: statSync(startupScreenshotPath).size,
      }
    : null,
};

if (!noScreenshot) {
  const electron = join(repoRoot, 'apps/canvas-workspace/node_modules/.bin/electron');
  const captureScript = join(skillDir, 'scripts/capture-dashboard.cjs');
  const command = existsSync('/usr/bin/xvfb-run') ? '/usr/bin/xvfb-run' : 'xvfb-run';
  const commandArgs = [
    '-a',
    electron,
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    captureScript,
    publicUrl,
    screenshotPath,
  ];

  const shot = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  });
  if (shot.status !== 0) {
    result.screenshot = {
      ok: false,
      error: (shot.stderr || shot.stdout || `exit ${shot.status}`).trim(),
    };
  } else if (existsSync(screenshotPath)) {
    result.screenshot = {
      ok: true,
      outputPath: screenshotPath,
      mimeType: 'image/png',
      bytes: statSync(screenshotPath).size,
    };
  }
}

console.log(JSON.stringify(result, null, 2));

if (result.screenshot?.ok) {
  console.log(`__PULSE_IMAGE_RESULT__${JSON.stringify({
    model: 'perf-dashboard-screenshot',
    outputPath: result.screenshot.outputPath,
    mimeType: result.screenshot.mimeType,
  })}`);
}
if (result.startupScreenshot?.ok) {
  console.log(`__PULSE_IMAGE_RESULT__${JSON.stringify({
    model: 'perf-electron-startup-screenshot',
    outputPath: result.startupScreenshot.outputPath,
    mimeType: result.startupScreenshot.mimeType,
  })}`);
}
