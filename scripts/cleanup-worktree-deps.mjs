#!/usr/bin/env node
import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { basename, dirname, join, resolve } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DEFAULT_DEVTOOLS_RUNS = join(homedir(), '.pulse-coder', 'devtools', 'runs');

const options = parseArgs(process.argv.slice(2));
const defaultWorktreeRoots = await resolveDefaultWorktreeRoots();
const worktreeRoots = options.worktreeRoots.length > 0 ? options.worktreeRoots : defaultWorktreeRoots;

const nodeModulesTargets = options.nodeModules
  ? await findWorktreeNodeModules(worktreeRoots)
  : [];
const devtoolsTargets = options.devtools
  ? await findOldDevtoolsRuns(options.devtoolsRunsDir, options.devtoolsMaxAgeDays, options.keepDevtoolsRuns)
  : [];
const targets = [...nodeModulesTargets, ...devtoolsTargets];

const totalKb = targets.reduce((sum, target) => sum + target.kb, 0);
const summary = {
  apply: options.apply,
  nodeModules: nodeModulesTargets.length,
  devtoolsRuns: devtoolsTargets.length,
  reclaimable: formatKb(totalKb),
};

if (options.json) {
  console.log(JSON.stringify({ summary, targets }, null, 2));
} else {
  console.log(`${options.apply ? 'Cleanup' : 'Dry run'}: ${nodeModulesTargets.length} worktree node_modules, ${devtoolsTargets.length} devtools runs, ${formatKb(totalKb)} total.`);
  for (const target of targets.slice(0, options.listLimit)) {
    console.log(`- ${formatKb(target.kb)} ${target.path}`);
  }
  if (targets.length > options.listLimit) {
    console.log(`... ${targets.length - options.listLimit} more`);
  }
  if (!options.apply) {
    console.log('Re-run with --apply to delete these generated directories.');
  }
}

if (options.apply) {
  for (const target of targets) {
    await removeTarget(target);
  }
}

function parseArgs(args) {
  const parsed = {
    apply: false,
    json: false,
    nodeModules: true,
    devtools: true,
    devtoolsRunsDir: DEFAULT_DEVTOOLS_RUNS,
    devtoolsMaxAgeDays: 3,
    keepDevtoolsRuns: 100,
    listLimit: 80,
    worktreeRoots: [],
  };

  for (const arg of args) {
    if (arg === '--apply') parsed.apply = true;
    else if (arg === '--json') parsed.json = true;
    else if (arg === '--no-node-modules') parsed.nodeModules = false;
    else if (arg === '--no-devtools') parsed.devtools = false;
    else if (arg.startsWith('--worktree-root=')) parsed.worktreeRoots.push(resolve(arg.slice('--worktree-root='.length)));
    else if (arg.startsWith('--devtools-runs-dir=')) parsed.devtoolsRunsDir = resolve(arg.slice('--devtools-runs-dir='.length));
    else if (arg.startsWith('--devtools-max-age-days=')) parsed.devtoolsMaxAgeDays = positiveNumber(arg, '--devtools-max-age-days=', parsed.devtoolsMaxAgeDays);
    else if (arg.startsWith('--keep-devtools-runs=')) parsed.keepDevtoolsRuns = Math.max(0, Math.floor(positiveNumber(arg, '--keep-devtools-runs=', parsed.keepDevtoolsRuns)));
    else if (arg.startsWith('--list-limit=')) parsed.listLimit = Math.max(0, Math.floor(positiveNumber(arg, '--list-limit=', parsed.listLimit)));
    else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function positiveNumber(arg, prefix, fallback) {
  const value = Number(arg.slice(prefix.length));
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function printHelp() {
  console.log(`Usage: pnpm cleanup:worktrees [options]\n\nOptions:\n  --apply                         Delete generated directories. Default is dry-run.\n  --no-node-modules               Skip wt-*/node_modules cleanup.\n  --no-devtools                   Skip old devtools run cleanup.\n  --worktree-root=<path>          Add a worktree root to scan. Can be repeated.\n  --devtools-runs-dir=<path>      Override devtools runs directory.\n  --devtools-max-age-days=<n>     Delete devtools runs older than n days. Default: 3.\n  --keep-devtools-runs=<n>        Always keep the newest n devtools runs. Default: 100.\n  --list-limit=<n>                Max target rows to print. Default: 80.\n  --json                          Print machine-readable output.`);
}

async function resolveDefaultWorktreeRoots() {
  const projectId = await resolveProjectId();
  return [
    join(homedir(), '.pulse-coder', 'worktrees', projectId),
    join(homedir(), projectId, 'worktrees'),
  ];
}

async function resolveProjectId() {
  const fromEnv = process.env.PULSE_CODER_PROJECT_ID?.trim();
  if (fromEnv) return normalizeProjectId(fromEnv);

  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--git-common-dir'], { maxBuffer: 1024 * 1024 });
    const commonDir = resolve(stdout.trim());
    const marker = '/.git/worktrees/';
    const worktreeMarkerIndex = commonDir.indexOf(marker);
    if (worktreeMarkerIndex >= 0) {
      return normalizeProjectId(basename(commonDir.slice(0, worktreeMarkerIndex)));
    }
    if (basename(commonDir) === '.git') {
      return normalizeProjectId(basename(dirname(commonDir)));
    }
  } catch {
    // Fall through to the repository default below.
  }

  return 'pulse-coder';
}

function normalizeProjectId(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'pulse-coder';
}

async function findWorktreeNodeModules(roots) {
  const targets = [];
  for (const root of roots.map((item) => resolve(item))) {
    if (!(await isDirectory(root))) continue;
    await walk(root, 0, 3, async (dir) => {
      if (basename(dir) !== 'node_modules') return;
      if (!basename(dirname(dir)).startsWith('wt-')) return;
      targets.push({ type: 'node_modules', path: dir, kb: await duKb(dir) });
    });
  }
  return sortTargets(targets);
}

async function walk(dir, depth, maxDepth, visit) {
  if (depth > maxDepth) return;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name === '.git') continue;
    const child = join(dir, entry.name);
    await visit(child);
    if (entry.name !== 'node_modules') {
      await walk(child, depth + 1, maxDepth, visit);
    }
  }
}

async function findOldDevtoolsRuns(runsDir, maxAgeDays, keepNewest) {
  if (!(await isDirectory(runsDir))) return [];
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const entries = await fs.readdir(runsDir, { withFileTypes: true });
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(runsDir, entry.name);
    const stat = await fs.stat(path);
    runs.push({ path, mtimeMs: stat.mtimeMs });
  }

  const protectedPaths = new Set(
    [...runs]
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, keepNewest)
      .map((run) => run.path),
  );

  const targets = [];
  for (const run of runs) {
    if (run.mtimeMs >= cutoff || protectedPaths.has(run.path)) continue;
    targets.push({ type: 'devtools_run', path: run.path, kb: await duKb(run.path) });
  }
  return sortTargets(targets);
}

async function removeTarget(target) {
  if (target.type === 'node_modules') {
    assertSafeNodeModulesTarget(target.path);
  } else if (target.type === 'devtools_run') {
    assertSafeDevtoolsTarget(target.path, options.devtoolsRunsDir);
  }
  await fs.rm(target.path, { recursive: true, force: true });
}

function assertSafeNodeModulesTarget(path) {
  if (basename(path) !== 'node_modules' || !basename(dirname(path)).startsWith('wt-')) {
    throw new Error(`Refusing to remove non-worktree node_modules path: ${path}`);
  }
}

function assertSafeDevtoolsTarget(path, runsDir) {
  const parent = resolve(dirname(path));
  if (parent !== resolve(runsDir)) {
    throw new Error(`Refusing to remove devtools path outside runs dir: ${path}`);
  }
}

async function isDirectory(path) {
  try {
    return (await fs.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function duKb(path) {
  try {
    const { stdout } = await execFileAsync('du', ['-sk', path], { maxBuffer: 1024 * 1024 });
    const value = Number(stdout.trim().split(/\s+/)[0]);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function sortTargets(targets) {
  return targets.sort((a, b) => b.kb - a.kb || a.path.localeCompare(b.path));
}

function formatKb(kb) {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(1)}G`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)}M`;
  return `${Math.round(kb)}K`;
}
