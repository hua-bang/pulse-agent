import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

function canonicalDestination(target) {
  let ancestor = target;
  const suffix = [];
  while (!fs.lstatSync(ancestor, { throwIfNoEntry: false })) {
    suffix.unshift(path.basename(ancestor));
    ancestor = path.dirname(ancestor);
  }
  return path.join(fs.realpathSync(ancestor), ...suffix);
}

function isWithin(directory, target) {
  const relative = path.relative(directory, target);
  return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

export function prepareReportPath(repoRoot, value) {
  if (!value) return null;
  const supplied = path.resolve(repoRoot, value);
  if (fs.lstatSync(supplied, { throwIfNoEntry: false })?.isSymbolicLink()) {
    throw new Error('Report target must be a regular generated report file: ' + value);
  }
  // Resolve parent aliases before checking identity, then write to this same
  // canonical destination. Missing report directories remain valid.
  const target = canonicalDestination(supplied);
  const gitDirs = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'], {
    cwd: repoRoot, encoding: 'utf8',
  });
  const metadata = gitDirs.status === 0 ? gitDirs.stdout.trim().split('\n').map((directory) => fs.realpathSync(directory)) : [];
  if ([supplied, target].some((file) => file.split(path.sep).includes('.git')) || metadata.some((directory) => isWithin(directory, target))) {
    throw new Error('Reports cannot be written into Git metadata');
  }
  const canonicalRoot = fs.realpathSync(repoRoot);
  if (isWithin(canonicalRoot, target)) {
    const relative = path.relative(canonicalRoot, target);
    const tracked = spawnSync('git', ['--literal-pathspecs', 'ls-files', '--error-unmatch', '--', relative], { cwd: repoRoot, stdio: 'ignore' });
    if (tracked.status === 0) throw new Error('Refusing to overwrite a tracked file with a report: ' + value);
  }
  if (fs.existsSync(target)) {
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024) {
      throw new Error('Report target must be a regular generated report file: ' + value);
    }
    if (stat.size) {
      let previous;
      try { previous = JSON.parse(fs.readFileSync(target, 'utf8')); } catch {}
      if (previous?.kind !== 'harness-validation' || previous.schemaVersion !== 1) {
        throw new Error('Refusing to overwrite a non-harness file: ' + value);
      }
    }
  }
  return target;
}

export function createReport(repoRoot, options) {
  const head = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  const status = spawnSync('git', ['status', '--porcelain=v1', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  return {
    kind: 'harness-validation', schemaVersion: 1,
    scope: 'selected-automatic-checks',
    startedAt: new Date().toISOString(), finishedAt: null,
    head: head.status === 0 ? head.stdout.trim() : null,
    dirtyWorktree: status.status === 0 ? Boolean(status.stdout) : null,
    source: { kind: options.all ? 'all' : options.since ? 'since' : options.paths.length ? 'path' : 'status', ref: options.since },
    level: options.level, status: 'planned', exitCode: null,
    paths: [], workspaces: [], commands: [], unmatchedPaths: [],
    deferredRules: [], manualChecks: [], escalations: [], uninspectedCommands: [], errors: [],
  };
}

export function writeReport(target, report) {
  if (!target) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + '.' + randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
