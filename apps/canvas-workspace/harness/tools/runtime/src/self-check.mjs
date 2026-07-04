import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './args.mjs';
import {
  APP_DIR,
  CURRENT_SESSION_PATH,
  DIST_MAIN,
  DIST_RENDERER,
  HARNESS_DIR,
} from './config.mjs';
import { HarnessError } from './errors.mjs';
import { printResult } from './output.mjs';

const RUNTIME_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_DIR = resolve(APP_DIR, '..', '..');
const EXPECTED_PACKAGE_SCRIPT = 'node ./harness/tools/runtime/cli.mjs';
const EXPECTED_COMMANDS = [
  'start',
  'status',
  'onboard',
  'screenshot',
  'snapshot-ui',
  'eval-renderer',
  'click',
  'fill',
  'press',
  'logs',
  'self-check',
  'close',
];
const EXPECTED_SRC_FILES = [
  'args.mjs',
  'cdp.mjs',
  'cli.mjs',
  'commands.mjs',
  'config.mjs',
  'errors.mjs',
  'input.mjs',
  'launch.mjs',
  'navigation.mjs',
  'output.mjs',
  'profiles.mjs',
  'renderer.mjs',
  'screenshot.mjs',
  'self-check.mjs',
  'session.mjs',
  'utils.mjs',
];

export async function selfCheckCommand(rawArgs) {
  const { opts } = parseArgs(rawArgs);
  const checks = [];
  const record = (name, ok, detail) => checks.push({ name, ok, detail });

  record(
    'app-dir',
    basename(APP_DIR) === 'canvas-workspace' && existsSync(join(APP_DIR, 'package.json')),
    APP_DIR,
  );
  record(
    'runtime-dir',
    relative(APP_DIR, RUNTIME_DIR) === join('harness', 'tools', 'runtime'),
    relative(APP_DIR, RUNTIME_DIR),
  );
  record(
    'artifact-dir',
    HARNESS_DIR === join(APP_DIR, '.harness')
      && CURRENT_SESSION_PATH === join(HARNESS_DIR, 'current-session.json'),
    relative(APP_DIR, HARNESS_DIR),
  );
  record(
    'dist-paths',
    relative(APP_DIR, DIST_MAIN) === join('dist', 'main', 'index.js')
      && relative(APP_DIR, DIST_RENDERER) === join('dist', 'renderer', 'index.html'),
    `${relative(APP_DIR, DIST_MAIN)}, ${relative(APP_DIR, DIST_RENDERER)}`,
  );

  const packageJson = JSON.parse(await fs.readFile(join(APP_DIR, 'package.json'), 'utf8'));
  record(
    'package-script',
    packageJson.scripts?.harness === EXPECTED_PACKAGE_SCRIPT,
    packageJson.scripts?.harness ?? '(missing)',
  );

  const cliSource = await fs.readFile(join(RUNTIME_DIR, 'src', 'cli.mjs'), 'utf8');
  for (const command of EXPECTED_COMMANDS) {
    record(`help:${command}`, cliSource.includes(`harness ${command}`), command);
  }

  for (const file of EXPECTED_SRC_FILES) {
    record(`src:${file}`, existsSync(join(RUNTIME_DIR, 'src', file)), file);
  }
  record('entrypoint', existsSync(join(RUNTIME_DIR, 'cli.mjs')), 'cli.mjs');
  record('readme', existsSync(join(RUNTIME_DIR, 'README.md')), 'README.md');

  const gitignore = await fs.readFile(join(REPO_DIR, '.gitignore'), 'utf8').catch(() => '');
  record(
    'artifact-gitignore',
    gitignore.includes('apps/canvas-workspace/.harness/'),
    'apps/canvas-workspace/.harness/',
  );

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    const lines = failed.map((check) => `${check.name}: ${check.detail}`).join('\n');
    throw new HarnessError(`Runtime harness self-check failed:\n${lines}`);
  }

  printResult(opts.json, { ok: true, checks }, [
    'Runtime harness self-check passed',
    ...checks.map((check) => `ok ${check.name}: ${check.detail}`),
  ]);
}
