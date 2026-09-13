#!/usr/bin/env node
import { execFile, spawn } from 'child_process';
import { promises as fs } from 'fs';
import { isAbsolute, join, relative, resolve, sep } from 'path';
import { pathToFileURL } from 'url';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

class ChildProcessExitError extends Error {
  constructor(code, signal) {
    super(`pnpm install failed with ${signal ? `signal ${signal}` : `exit code ${code}`}`);
    this.exitCode = code;
    this.signal = signal;
  }
}

export async function buildBootstrapPlan(options = {}) {
  const cwd = resolve(options.cwd ?? process.cwd());
  const repoRoot = await resolveRepoRoot(cwd, options.execFile ?? execFileAsync);
  await assertLocalNodeModules(repoRoot);

  const storeDir = resolve(
    options.storeDir
      ?? await resolvePnpmStore(repoRoot, options.execFile ?? execFileAsync, options.platform),
  );
  const packageImportMethod = await resolvePackageImportMethod(repoRoot, storeDir);

  return {
    repoRoot,
    storeDir,
    packageImportMethod,
    command: resolvePnpmCommand(options.platform),
    args: ['install', '--frozen-lockfile', '--prefer-offline'],
    shell: resolvePnpmShell(options.platform),
    env: {
      npm_config_store_dir: storeDir,
      npm_config_package_import_method: packageImportMethod,
    },
  };
}

export async function assertLocalNodeModules(repoRoot) {
  const canonicalRoot = await fs.realpath(repoRoot);
  const nodeModulesPaths = await findNodeModulesPaths(repoRoot);
  const dependencyLayoutPaths = nodeModulesPaths.flatMap((path) => [path, join(path, '.pnpm')]);
  for (const path of dependencyLayoutPaths) {
    let stat;
    try {
      stat = await fs.lstat(path);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    if (!stat.isSymbolicLink()) {
      continue;
    }

    const target = await fs.realpath(path);
    if (!isInside(canonicalRoot, target)) {
      throw new Error(
        `Refusing to bootstrap with cross-worktree dependency link: ${path} -> ${target}. Remove the node_modules symlink and retry.`,
      );
    }
  }
}

export async function resolvePackageImportMethod(repoRoot, storeDir) {
  let sourceDir;
  let targetDir;
  try {
    sourceDir = await fs.mkdtemp(join(storeDir, '.pulse-worktree-link-probe-'));
    targetDir = await fs.mkdtemp(join(repoRoot, '.pulse-worktree-link-probe-'));
    const source = join(sourceDir, 'source');
    const target = join(targetDir, 'target');
    await fs.writeFile(source, 'probe');
    await fs.link(source, target);
    return 'hardlink';
  } catch {
    return 'clone-or-copy';
  } finally {
    await Promise.all([
      sourceDir ? fs.rm(sourceDir, { recursive: true, force: true }) : undefined,
      targetDir ? fs.rm(targetDir, { recursive: true, force: true }) : undefined,
    ]);
  }
}

export function resolvePnpmCommand(platform = process.platform) {
  return platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
}

export function resolvePnpmShell(platform = process.platform) {
  return platform === 'win32';
}

async function resolveRepoRoot(cwd, runExecFile) {
  const { stdout } = await runExecFile('git', ['-C', cwd, 'rev-parse', '--show-toplevel']);
  const repoRoot = stdout.trim();
  if (!repoRoot) {
    throw new Error(`Unable to resolve git repository root from ${cwd}`);
  }
  return resolve(repoRoot);
}

async function resolvePnpmStore(repoRoot, runExecFile, platform) {
  const { stdout } = await runExecFile(resolvePnpmCommand(platform), ['store', 'path'], {
    cwd: repoRoot,
    shell: resolvePnpmShell(platform),
  });
  const storeDir = stdout.trim();
  if (!storeDir) {
    throw new Error('pnpm store path returned an empty path');
  }
  return storeDir;
}

async function findNodeModulesPaths(repoRoot) {
  const paths = [join(repoRoot, 'node_modules')];
  for (const parentName of ['packages', 'apps']) {
    const parent = join(repoRoot, parentName);
    let entries;
    try {
      entries = await fs.readdir(parent, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        paths.push(join(parent, entry.name, 'node_modules'));
      }
    }
  }
  return paths;
}

function isInside(parent, child) {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function parseArgs(args) {
  const normalizedArgs = args.filter((arg) => arg !== '--');
  const allowed = new Set(['--dry-run', '--json', '--help', '-h']);
  const unknown = normalizedArgs.find((arg) => !allowed.has(arg));
  if (unknown) {
    throw new Error(`Unknown argument: ${unknown}`);
  }

  const json = normalizedArgs.includes('--json');
  return {
    dryRun: normalizedArgs.includes('--dry-run') || json,
    json,
    help: normalizedArgs.includes('--help') || normalizedArgs.includes('-h'),
  };
}

function printHelp() {
  console.log(`Usage: pnpm bootstrap:worktree [--dry-run] [--json]\n\nInstalls this worktree with the shared pnpm store while keeping its node_modules layout local.\n\nOptions:\n  --dry-run  Print the resolved install plan without running pnpm install.\n  --json     Print the plan as JSON.\n  --help     Show this help.`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const plan = await buildBootstrapPlan();
  if (options.json) {
    console.log(JSON.stringify(plan, null, 2));
  } else {
    console.log(`Worktree: ${plan.repoRoot}`);
    console.log(`Shared pnpm store: ${plan.storeDir}`);
    console.log(`Package import method: ${plan.packageImportMethod}`);
  }

  if (options.dryRun) {
    return;
  }

  await new Promise((resolvePromise, reject) => {
    const child = spawn(plan.command, plan.args, {
      cwd: plan.repoRoot,
      env: { ...process.env, ...plan.env },
      shell: plan.shell,
      stdio: 'inherit',
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new ChildProcessExitError(code, signal));
    });
  });
}

const entryPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entryPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    if (error instanceof ChildProcessExitError && typeof error.exitCode === 'number') {
      process.exitCode = error.exitCode;
      return;
    }
    if (error instanceof ChildProcessExitError && error.signal) {
      process.kill(process.pid, error.signal);
      return;
    }
    process.exitCode = 1;
  });
}
