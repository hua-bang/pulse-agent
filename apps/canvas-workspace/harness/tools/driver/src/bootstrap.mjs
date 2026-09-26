import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Pure-ish helpers for `harness:up` (quickstart.mjs). Node builtins only:
 * quickstart runs before `pnpm install`, so nothing here may import a
 * workspace dependency.
 */

const SKIP_DIRS = new Set(['node_modules', 'dist', '.harness', 'release', '.git']);

/** Newest mtime (ms) among files under the given paths; 0 when none exist. */
export function newestMtime(paths) {
  let newest = 0;
  const visit = (path) => {
    let stat;
    try { stat = statSync(path); } catch { return; }
    if (!stat.isDirectory()) {
      newest = Math.max(newest, stat.mtimeMs);
      return;
    }
    for (const entry of readdirSync(path)) {
      if (!SKIP_DIRS.has(entry)) visit(join(path, entry));
    }
  };
  paths.forEach(visit);
  return newest;
}

/** A build target is stale when its output is missing or older than any input. */
export function isBuildStale({ output, inputs }) {
  if (!existsSync(output)) return true;
  return newestMtime(inputs) > statSync(output).mtimeMs;
}

/**
 * Electron's SQLite binding lives beside the host-Node one in canvas-cli's
 * dist/native as `<platform>-<arch>-<abi>.node`. Any ABI other than the host
 * Node's is the Electron binding prepare-sqlite-native.mjs produced.
 */
export function hasElectronSqliteBinding(nativeDir, {
  platform = process.platform,
  arch = process.arch,
  hostAbi = process.versions.modules,
  list = (dir) => (existsSync(dir) ? readdirSync(dir) : []),
} = {}) {
  const pattern = new RegExp(`^${platform}-${arch}-(\\d+)\\.node$`);
  return list(nativeDir).some((name) => {
    const abi = pattern.exec(name)?.[1];
    return abi !== undefined && abi !== String(hostAbi);
  });
}

/**
 * Build chain in dependency order: storage feeds engine/agent-teams and
 * canvas-cli, the app bundles them, so a stale upstream forces every later
 * step. canvas-cli builds with tsup `clean`, which wipes dist/native, so the
 * Electron SQLite binding step sits right after it.
 */
export function buildTargets(repoRoot) {
  const app = join(repoRoot, 'apps', 'canvas-workspace');
  // tsup.config.ts owns the entry list: a new entry can land there alone.
  const pkg = (dir, output, filter, extraInputs = []) => ({
    name: filter,
    command: ['pnpm', ['--filter', filter, 'build'], repoRoot],
    output: join(repoRoot, dir, output),
    inputs: ['src', 'package.json', 'tsup.config.ts', ...extraInputs].map((input) => join(repoRoot, dir, input)),
  });
  const nativeDir = join(repoRoot, 'packages', 'canvas-cli', 'dist', 'native');
  return [
    pkg('packages/storage', 'dist/index.js', '@pulse-coder/storage'),
    pkg('packages/engine', 'dist/index.js', 'pulse-coder-engine'),
    pkg('packages/agent-teams', 'dist/index.js', 'pulse-coder-agent-teams'),
    // Its build copies skills/ into dist, where unpackaged Canvas tooling reads them.
    pkg('packages/canvas-cli', 'dist/index.cjs', '@pulse-coder/canvas-cli', ['skills']),
    {
      name: 'electron-sqlite-binding',
      command: ['node', ['scripts/setup/prepare-sqlite-native.mjs'], app],
      isStale: () => !hasElectronSqliteBinding(nativeDir),
    },
    {
      name: 'canvas-workspace',
      command: ['pnpm', ['--filter', 'canvas-workspace', 'build'], repoRoot],
      output: join(app, 'dist', 'main', 'index.js'),
      inputs: [join(app, 'src'), join(app, 'package.json'), join(app, 'electron.vite.config.ts')],
    },
  ];
}

export const defaultStale = (target) => (target.isStale ? target.isStale() : isBuildStale(target));

/** Targets to rebuild: the first stale one and everything after it. */
export function planBuilds(targets, stale = defaultStale) {
  const first = targets.findIndex((target) => stale(target));
  return first === -1 ? [] : targets.slice(first);
}

/**
 * CA file for Chromium trust. Explicit choice wins; otherwise, only behind an
 * HTTPS proxy, reuse the bundle Node was already told to trust.
 */
export function resolveQuickstartCa(opts, env = process.env, exists = existsSync) {
  const explicit = opts['ca-cert'] ?? env.PULSE_CANVAS_HARNESS_CA_CERT;
  if (explicit) return explicit;
  if (!(env.HTTPS_PROXY || env.https_proxy)) return undefined;
  return [env.NODE_EXTRA_CA_CERTS, env.SSL_CERT_FILE].find((file) => file && exists(file));
}

export const hasCommand = (command) =>
  spawnSync('sh', ['-c', `command -v ${command}`], { stdio: 'ignore' }).status === 0;

/** Debian package for each system binary the headless path needs. */
export const SYSTEM_PACKAGES = { Xvfb: 'xvfb', certutil: 'libnss3-tools' };

export function missingSystemPackages({ needXvfb, needCa, has = hasCommand }) {
  const binaries = [...(needXvfb ? ['Xvfb'] : []), ...(needCa ? ['certutil'] : [])];
  return binaries.filter((bin) => !has(bin)).map((bin) => SYSTEM_PACKAGES[bin]);
}

/** Library names `ldd` reports as `libfoo.so.1 => not found`. */
export function missingSharedLibraries(lddOutput) {
  const names = [...lddOutput.matchAll(/^\s*(\S+)\s+=>\s+not found/gm)].map((match) => match[1]);
  return [...new Set(names)];
}

/** Command line of a live pid, or '' when unknown (gone, or no way to read it). */
export function processCommandLine(pid, platform = process.platform) {
  try {
    if (platform === 'linux') return readFileSync(`/proc/${pid}/cmdline`, 'utf-8').replaceAll('\0', ' ');
    if (platform === 'win32') {
      const query = `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`;
      return spawnSync('powershell', ['-NoProfile', '-Command', query], { encoding: 'utf-8' }).stdout ?? '';
    }
    return spawnSync('ps', ['-o', 'args=', '-p', String(Number(pid))], { encoding: 'utf-8' }).stdout ?? '';
  } catch {
    return '';
  }
}

export const isMockProcess = (pid, commandLine = processCommandLine) =>
  Number.isInteger(pid) && pid > 0 && commandLine(pid).includes('mock-llm.mjs');
