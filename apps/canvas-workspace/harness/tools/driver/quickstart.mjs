#!/usr/bin/env node
/**
 * One-command real-app debugging: `pnpm --filter canvas-workspace harness:up`.
 *
 * Idempotent; every step is skipped when already satisfied, so a warm rerun
 * only relaunches the app:
 *   1. system packages for headless Linux (Xvfb, certutil) via apt when root
 *   2. `pnpm install` when node_modules, the Electron binary or node-pty is missing
 *   3. rebuild engine → agent-teams → canvas-cli → app from the first stale one
 *   4. start harness/mock-llm.mjs unless a real model key is configured
 *   5. `harness start` with --headless / --ca-cert chosen for this host
 *
 * `harness:down` closes the session and stops the mock LLM.
 * Uses Node builtins only: it must run before dependencies are installed.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildTargets,
  hasCommand,
  missingSystemPackages,
  planBuilds,
  resolveQuickstartCa,
} from './src/bootstrap.mjs';

const DRIVER_DIR = dirname(fileURLToPath(import.meta.url));
const APP_DIR = resolve(DRIVER_DIR, '../../..');
const REPO_ROOT = resolve(APP_DIR, '../..');
const CLI = join(DRIVER_DIR, 'cli.mjs');
const MOCK_STATE = join(APP_DIR, '.harness', 'mock-llm.json');
const MODEL_KEYS = ['OPENAI_API_KEY', 'PULSE_OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'PULSE_ANTHROPIC_API_KEY'];

const startedAt = Date.now();
const log = (message) => console.log(`[harness:up +${((Date.now() - startedAt) / 1000).toFixed(1)}s] ${message}`);
const fail = (message) => {
  console.error(`[harness:up] ${message}`);
  process.exit(1);
};
const run = (command, args, options = {}) =>
  spawnSync(command, args, { stdio: 'inherit', cwd: REPO_ROOT, ...options }).status === 0;

function parseArgs(argv) {
  const opts = { command: 'up', profile: 'demo', mockPort: 18100, passthrough: [] };
  const args = [...argv];
  if (args[0] === 'up' || args[0] === 'down') opts.command = args.shift();
  while (args.length) {
    const arg = args.shift();
    if (arg === '--no-mock-llm') opts.noMock = true;
    else if (arg === '--no-ca') opts.noCa = true;
    else if (arg === '--skip-build') opts.skipBuild = true;
    else if (arg === '--profile') opts.profile = args.shift();
    else if (arg === '--mock-port') opts.mockPort = Number(args.shift());
    else if (arg === '--ca-cert') opts['ca-cert'] = args.shift();
    else opts.passthrough.push(arg);
  }
  return opts;
}

function ensureSystemPackages({ needXvfb, needCa }) {
  const missing = missingSystemPackages({ needXvfb, needCa });
  if (!missing.length) return true;
  const canApt = process.platform === 'linux' && process.getuid?.() === 0 && hasCommand('apt-get');
  if (!canApt) {
    if (missing.includes('xvfb')) fail(`Missing system packages: ${missing.join(' ')}. Install them and rerun.`);
    return false;
  }
  log(`installing system packages: ${missing.join(' ')}`);
  const install = () => run('apt-get', ['install', '-y', '-q', ...missing], { stdio: 'ignore' });
  if (!install()) {
    // Stale package index (404 on the pinned .deb) is the common failure.
    run('apt-get', ['update', '-q'], { stdio: 'ignore' });
    if (!install()) {
      if (missing.includes('xvfb')) fail(`apt-get could not install ${missing.join(' ')}.`);
      return false;
    }
  }
  return true;
}

function dependenciesReady() {
  const modulesYaml = join(REPO_ROOT, 'node_modules', '.modules.yaml');
  const lockfile = join(REPO_ROOT, 'pnpm-lock.yaml');
  if (!existsSync(modulesYaml) || statSync(modulesYaml).mtimeMs < statSync(lockfile).mtimeMs) return false;
  try {
    const nodePty = realpathSync(join(APP_DIR, 'node_modules', 'node-pty'));
    return existsSync(join(nodePty, 'build', 'Release', 'pty.node')) && electronReady();
  } catch {
    return false;
  }
}

function electronReady() {
  try {
    const electron = realpathSync(join(APP_DIR, 'node_modules', 'electron'));
    return existsSync(join(electron, 'path.txt')) && existsSync(join(electron, 'dist'));
  } catch {
    return false;
  }
}

function ensureDependencies() {
  if (dependenciesReady()) return;
  log('installing dependencies (pnpm install --frozen-lockfile)');
  if (!run('pnpm', ['install', '--frozen-lockfile'])) fail('pnpm install failed.');
  if (!electronReady() && !run('pnpm', ['--filter', 'canvas-workspace', 'setup:electron'])) {
    fail('Electron binary is missing and setup:electron could not download it.');
  }
}

function ensureBuilds(skip) {
  const builds = planBuilds(buildTargets(REPO_ROOT));
  if (!builds.length) return;
  if (skip) {
    log(`--skip-build: ${builds.map((target) => target.filter).join(', ')} may be stale`);
    return;
  }
  for (const target of builds) {
    log(`building ${target.filter}`);
    if (!run('pnpm', ['--filter', target.filter, 'build'], { stdio: ['ignore', 'ignore', 'inherit'] })) {
      fail(`build failed: pnpm --filter ${target.filter} build`);
    }
  }
}

const readMockState = () => {
  try { return JSON.parse(readFileSync(MOCK_STATE, 'utf-8')); } catch { return null; }
};

const mockResponds = async (port) => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
};

async function ensureMockLlm(port) {
  if (await mockResponds(port)) return;
  const child = spawn(process.execPath, [join(APP_DIR, 'harness', 'mock-llm.mjs'), String(port)], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  mkdirSync(dirname(MOCK_STATE), { recursive: true });
  writeFileSync(MOCK_STATE, JSON.stringify({ pid: child.pid, port }));
  for (let i = 0; i < 50; i++) {
    if (await mockResponds(port)) return;
    await new Promise((done) => setTimeout(done, 100));
  }
  fail(`mock LLM did not answer on port ${port}.`);
}

function stopMockLlm() {
  const state = readMockState();
  if (!state) return;
  try { process.kill(state.pid, 'SIGTERM'); } catch { /* already gone */ }
  rmSync(MOCK_STATE, { force: true });
}

async function up(opts) {
  const linux = process.platform === 'linux';
  // Root cannot start Electron without --no-sandbox, which only --headless adds.
  const headless = linux && (!process.env.DISPLAY || process.getuid?.() === 0);
  const caFile = opts.noCa || !linux ? undefined : resolveQuickstartCa(opts);
  const caUsable = ensureSystemPackages({ needXvfb: linux && !process.env.DISPLAY, needCa: Boolean(caFile) });
  if (caFile && !caUsable) log('certutil unavailable: HTTPS webviews may fail behind the proxy');

  ensureDependencies();
  ensureBuilds(opts.skipBuild);

  const env = { ...process.env };
  const useMock = !opts.noMock && !MODEL_KEYS.some((key) => process.env[key]);
  if (useMock) {
    await ensureMockLlm(opts.mockPort);
    Object.assign(env, { OPENAI_API_URL: `http://127.0.0.1:${opts.mockPort}/v1`, OPENAI_API_KEY: 'mock' });
  }

  log(`launching profile=${opts.profile}${headless ? ' headless' : ''}${caFile && caUsable ? ` ca=${caFile}` : ''}`);
  const startArgs = [
    CLI, 'start', '--profile', opts.profile, '--force',
    ...(headless ? ['--headless'] : []),
    ...(caFile && caUsable ? ['--ca-cert', caFile] : []),
    ...opts.passthrough,
  ];
  if (!run(process.execPath, startArgs, { cwd: APP_DIR, env })) fail('harness start failed (see stderr above).');

  log(`ready${useMock ? ` · chat uses mock LLM on :${opts.mockPort}` : ''}`);
  console.log([
    '',
    'Next: pnpm --filter canvas-workspace harness screenshot | snapshot-ui | eval-renderer <js> | logs',
    'Stop: pnpm --filter canvas-workspace harness:down',
  ].join('\n'));
}

function down() {
  run(process.execPath, [CLI, 'close', '--cleanup'], { cwd: APP_DIR });
  stopMockLlm();
}

const opts = parseArgs(process.argv.slice(2));
if (opts.command === 'down') down();
else await up(opts);
