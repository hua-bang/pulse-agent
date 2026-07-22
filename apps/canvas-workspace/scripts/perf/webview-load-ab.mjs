#!/usr/bin/env node
/** Run the deterministic webview initial-load check in two fresh profiles. */
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const harness = join(appRoot, 'harness/tools/driver/cli.mjs');
const check = join(appRoot, 'scripts/perf/webview-load-check.mjs');

const run = (script, args, env = process.env) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(process.execPath, [script, ...args], {
    cwd: appRoot,
    env,
    stdio: 'inherit',
  });
  child.once('error', rejectRun);
  child.once('exit', (code, signal) => {
    if (code === 0) resolveRun();
    else rejectRun(new Error(`${script} exited ${code ?? signal}`));
  });
});

for (const concurrency of [0, 2]) {
  console.log(`\n[perf:webview-load:ab] fresh profile, concurrency=${concurrency}`);
  const env = {
    ...process.env,
    PULSE_CANVAS_PERF: '1',
    PULSE_CANVAS_WEBVIEW_CONCURRENCY: String(concurrency),
  };
  await run(harness, ['start', '--profile', 'temp', '--force', '--json'], env);
  try {
    await run(check, [], env);
  } finally {
    await run(harness, ['close', '--cleanup', '--json'], env).catch((error) => {
      console.warn(`[perf:webview-load:ab] cleanup failed: ${error.message}`);
    });
  }
}
