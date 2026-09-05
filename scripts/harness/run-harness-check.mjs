#!/usr/bin/env node
// Manual runner for the harness Validate surface (harness/ROADMAP.md keystone,
// phase 1). Maps changed paths to the affected workspaces, reads each
// workspace's harness/validate/validation.yaml plus the root overlay, and
// executes the bound `required` commands serially with a pass/fail report.
//
// Usage:
//   node scripts/harness/run-harness-check.mjs                 # paths from git status
//   node scripts/harness/run-harness-check.mjs --since <ref>   # paths from ref...HEAD
//   node scripts/harness/run-harness-check.mjs --path <p...>   # explicit repo-relative paths
//   node scripts/harness/run-harness-check.mjs --all           # every bound check (full sweep)
//   Add --level quick|standard|release (default: quick; --all: release).
//   Add --dry-run to print the plan without executing.
//
// escalateWhen / escalationRules need human judgement (is this a public API
// change?) — they are printed as reminders, never auto-executed.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createReport, prepareReportPath, writeReport } from './report.mjs';
import { discoverWorkspaces, inspectCommand, matchesAny, readValidation } from './validation-data.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEVELS = ['quick', 'standard', 'release'];

function addRuleCommands(rule, plan, source, level) {
  let selected = 0;
  const add = (cmd, reason) => { selected += 1; plan.addCommand(cmd, reason); };
  const quick = Array.isArray(rule.quick) ? rule.quick : null;
  if (quick) {
    for (const cmd of quick) add(cmd, `${source} · quick`);
  } else if (level === 'quick') {
    // Validation files without tiered commands retain their old behavior.
    for (const cmd of rule.required || []) add(cmd, source);
  }
  if (level !== 'quick') {
    for (const cmd of rule.required || []) add(cmd, source);
  }
  if (level === 'release') {
    for (const cmd of rule.release || []) add(cmd, `${source} · release`);
  }
  if (!selected) plan.deferredRules.push({ source, commands: [...(rule.required ?? []), ...(rule.release ?? [])] });
}


function normalizeExplicitPath(input) {
  const absolute = path.resolve(repoRoot, input);
  let cursor = absolute;
  const suffix = [];
  while (!fs.existsSync(cursor)) {
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error('Cannot resolve path: ' + input);
    suffix.unshift(path.basename(cursor));
    cursor = parent;
  }
  const canonicalRoot = fs.realpathSync(repoRoot);
  const canonical = path.join(fs.realpathSync(cursor), ...suffix);
  const canonicalRelative = path.relative(canonicalRoot, canonical);
  const outside = (relative) => relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative);
  if (outside(canonicalRelative)) throw new Error('Path is outside the repository: ' + input);
  const lexicalRelative = path.relative(repoRoot, absolute);
  const relative = outside(lexicalRelative) ? canonicalRelative : lexicalRelative;
  return relative.split(path.sep).join('/') || '.';
}

function expandDirectoryPaths(repoPaths) {
  const expanded = new Set();
  for (const input of repoPaths) {
    const relative = normalizeExplicitPath(input);
    const absolute = path.join(repoRoot, relative);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isDirectory()) {
      for (const file of git(['ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', relative]).split('\0')) {
        if (file) expanded.add(file);
      }
    } else expanded.add(relative);
  }
  return [...expanded];
}

// --- changed-path sources ---

function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function pathsFromStatus() {
  const records = git(['status', '--porcelain=v1', '-z', '--untracked-files=all']).split('\0');
  const changed = new Set();
  for (let i = 0; i < records.length; i += 1) {
    const record = records[i];
    if (!record) continue;
    changed.add(record.slice(3));
    if (/[RC]/.test(record.slice(0, 2)) && records[i + 1]) changed.add(records[++i]);
  }
  return [...changed];
}

function pathsFromRange(ref) {
  const commit = git(['rev-parse', '--verify', '--end-of-options', ref + '^{commit}']).trim();
  const records = git(['diff', '--name-status', '--find-renames', '-z', commit + '...HEAD', '--']).split('\0');
  const changed = new Set();
  for (let i = 0; i < records.length; i += 1) {
    const status = records[i];
    if (!status) continue;
    if (records[i + 1]) changed.add(records[++i]);
    if (/^[RC]/.test(status) && records[i + 1]) changed.add(records[++i]);
  }
  return [...changed];
}

// --- plan assembly ---

function loadValidation(relFile, required = false) {
  return readValidation(repoRoot, relFile, { required });
}

function collectForWorkspace(workspace, relPaths, plan, { all = false, level = 'quick' } = {}) {
  const file = path.posix.join(workspace, 'harness/validate/validation.yaml');
  const validation = loadValidation(file, true);
  for (const rule of validation.pathRules || []) {
    const hits = relPaths.filter((p) => matchesAny(p, rule.paths));
    if (!all && !hits.length) continue;
    for (const hit of hits) plan.matchedPaths.add(path.posix.join(workspace, hit));
    addRuleCommands(rule, plan, `${workspace} · ${rule.name}`, level);
    for (const kind of ['manual', 'optional']) for (const text of rule[kind] ?? []) {
      plan.notes.push({ source: workspace + ' · ' + rule.name, kind, text, status: 'not-run' });
    }
  }
}

function collectForRoot(rootPaths, plan, { all = false, level = 'quick' } = {}) {
  const validation = loadValidation('harness/validate/validation.yaml');
  if (!validation) return;
  for (const rule of validation.pathRules || []) {
    const hits = rootPaths.filter((p) => matchesAny(p, rule.paths));
    if (!all && !hits.length) continue;
    for (const hit of hits) plan.matchedPaths.add(hit);
    addRuleCommands(rule, plan, `root · ${rule.name}`, level);
    for (const kind of ['manual', 'optional']) for (const text of rule[kind] ?? []) {
      plan.notes.push({ source: 'root · ' + rule.name, kind, text, status: 'not-run' });
    }
  }
}

function escalationReminders(affectedWorkspaces, paths, all) {
  const validation = loadValidation('harness/validate/validation.yaml');
  const rules = validation?.escalationRules || {};
  const normalized = affectedWorkspaces.map((ws) => ws.split('/').pop().replace(/[^a-z]/gi, '').toLowerCase());
  const reminders = [];
  for (const [name, rule] of Object.entries(rules)) {
    const key = name.toLowerCase();
    const matchedPaths = rule.paths ? paths.filter((file) => matchesAny(file, rule.paths)) : [];
    const matches = rule.paths ? matchedPaths.length > 0 : normalized.some((ws) => ws && key.includes(ws));
    if (!all && !matches) continue;
    reminders.push({ name, commands: rule.required || [], matchedPaths, status: 'not-run',
      reason: all ? 'all rules requested' : rule.paths ? 'changed paths' : 'affected workspace (legacy)' });
  }
  return reminders;
}

// --- main ---

function parseArgs(argv) {
  const options = { paths: [], all: false, dryRun: false, since: null, level: null, report: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') options.all = true;
    else if (arg === '--level' || arg === '--since' || arg === '--report') {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(arg + ' requires a value');
      if (arg === '--level') options.level = value;
      else if (arg === '--since') options.since = value;
      else options.report = value;
    }
    else if (arg === '--dry-run' || arg === '--list') options.dryRun = true;
    else if (arg === '--path') {
      const start = options.paths.length;
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) options.paths.push(argv[++i]);
      if (options.paths.length === start) throw new Error('--path requires at least one path');
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: run-harness-check.mjs [--all] [--since <ref>] [--path <p...>] [--level quick|standard|release] [--dry-run] [--report <file>]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (Number(options.all) + Number(options.since !== null) + Number(options.paths.length > 0) > 1) {
    throw new Error('Choose one path source: --all, --since, or --path');
  }
  options.level ??= options.all ? 'release' : 'quick';
  if (!LEVELS.includes(options.level)) {
    console.error(`Invalid --level: ${options.level}. Expected ${LEVELS.join(', ')}.`);
    process.exit(2);
  }
  return options;
}

function runChecks(options, report, reportPath) {
  const workspaceRecords = discoverWorkspaces(repoRoot);
  const workspaces = workspaceRecords.map((workspace) => workspace.dir);

  let changed = options.paths;
  if (options.paths.length > 0) {
    // A `--path` that names a directory means "every file under here", so rule
    // globs (src/**) can bind. Git-status paths are already individual files.
    changed = expandDirectoryPaths(options.paths);
  } else if (!options.all) {
    changed = options.since ? pathsFromRange(options.since) : pathsFromStatus();
    if (changed.length === 0) {
      console.log('Working tree clean and no --path given. Use --since <ref>, --path, or --all.');
      report.status = 'no-checks';
      report.exitCode = 0;
      return;
    }
  }
  report.paths = changed;

  const plan = {
    commands: [],
    sources: new Map(),
    notes: [],
    warnings: [],
    matchedPaths: new Set(),
    deferredRules: [],
    addCommand(cmd, source) {
      if (!this.sources.has(cmd)) {
        this.sources.set(cmd, []);
        this.commands.push(cmd);
      }
      this.sources.get(cmd).push(source);
    },
  };

  let affected = [];
  if (options.all) {
    affected = workspaces;
    for (const ws of workspaces) collectForWorkspace(ws, [], plan, { all: true, level: options.level });
    collectForRoot([], plan, { all: true, level: options.level });
  } else {
    const byWorkspace = new Map();
    for (const p of changed) {
      const posix = p.split(path.sep).join('/');
      const owner = workspaces
        .filter((ws) => posix.startsWith(`${ws}/`))
        .sort((a, b) => b.length - a.length)[0];
      if (!owner) continue;
      if (!byWorkspace.has(owner)) byWorkspace.set(owner, []);
      byWorkspace.get(owner).push(posix.slice(owner.length + 1));
    }
    affected = [...byWorkspace.keys()];
    for (const [ws, rels] of byWorkspace) collectForWorkspace(ws, rels, plan, { level: options.level });
    // The root file is an overlay: its pathRules see every changed path
    // (repo-relative), not just the ones outside any workspace.
    collectForRoot(changed.map((p) => p.split(path.sep).join('/')), plan, { level: options.level });
  }

  report.workspaces = affected;
  report.commands = plan.commands.map((command) => ({
    command, cwd: repoRoot, reasons: plan.sources.get(command), status: 'planned', exitCode: null, durationMs: null,
  }));
  report.unmatchedPaths = changed.filter((file) => !plan.matchedPaths.has(file));
  report.deferredRules = plan.deferredRules;
  report.manualChecks = plan.notes;
  report.escalations = escalationReminders(affected, changed, options.all);
  const unboundManaged = report.unmatchedPaths.filter((file) => {
    const owner = workspaces.find((workspace) => file.startsWith(workspace + '/'));
    const local = owner ? file.slice(owner.length + 1) : file;
    return (owner && local.startsWith('src/')) ||
      /^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig(?:\.[^/]+)?\.json|vitest\.config\.[^/]+|tsup\.config\.[^/]+|electron\.vite\.config\.[^/]+|electron-builder\.[^/]+)$/.test(local) ||
      file.startsWith('.github/workflows/');
  });
  if (unboundManaged.length) throw new Error('No validation rule for managed paths:\n' + unboundManaged.join('\n'));

  const commandErrors = [];
  for (const cmd of plan.commands) {
    const inspection = inspectCommand(cmd, repoRoot, workspaceRecords);
    for (const error of inspection.errors) commandErrors.push(cmd + ': ' + error);
    if (inspection.uninspected.length) report.uninspectedCommands.push({ command: cmd, reasons: inspection.uninspected });
    for (const reason of inspection.uninspected) plan.warnings.push('Uninspected command reference: ' + reason);
  }
  if (commandErrors.length) throw new Error('Invalid bound checks:\n' + commandErrors.join('\n'));

  console.log(`Validation level: ${options.level}`);
  console.log(`Affected workspaces: ${affected.length ? affected.join(', ') : '(none)'}`);
  for (const warning of new Set(plan.warnings)) console.log(`! ${warning}`);

  if (plan.commands.length === 0) {
    console.log(plan.deferredRules.length ? 'Matched checks are deferred by validation level.' : 'No bound checks for these paths (document/auxiliary scope).');
  }

  if (options.dryRun) {
    for (const cmd of plan.commands) {
      console.log(`plan: ${cmd}   [${plan.sources.get(cmd).join('; ')}]`);
    }
  }

  const results = [];
  if (!options.dryRun) {
    report.status = 'running';
    for (const cmd of plan.commands) {
      const evidence = report.commands.find((item) => item.command === cmd);
      evidence.status = 'running';
      writeReport(reportPath, report);
      console.log(`\n▶ ${cmd}   [${plan.sources.get(cmd).join('; ')}]`);
      const startedAt = Date.now();
      const run = spawnSync('sh', ['-c', cmd], { cwd: repoRoot, stdio: 'inherit' });
      evidence.exitCode = run.status ?? 1;
      evidence.durationMs = Date.now() - startedAt;
      evidence.status = evidence.exitCode === 0 ? 'passed' : 'failed';
      results.push({ cmd, code: evidence.exitCode, seconds: (evidence.durationMs / 1000).toFixed(1) });
      writeReport(reportPath, report);
    }
  }

  if (plan.notes.length) {
    console.log('\nNotes (not auto-run):');
    for (const note of plan.notes) console.log('- ' + note.source + ' (' + note.kind + '): ' + note.text);
  }

  const reminders = report.escalations;
  if (reminders.length) {
    console.log('\nEscalation reminders (run manually if the change qualifies):');
    for (const reminder of reminders) {
      console.log(`- ${reminder.name}: ${reminder.commands.join(' && ')}`);
      if (reminder.matchedPaths.length) console.log('  matched: ' + reminder.matchedPaths.slice(0, 3).join(', '));
    }
  }

  if (!options.dryRun && results.length) {
    console.log('\nSummary:');
    let failed = 0;
    for (const result of results) {
      const mark = result.code === 0 ? '✓' : '✗';
      if (result.code !== 0) failed += 1;
      console.log(`${mark} ${result.cmd} (${result.seconds}s)`);
    }
    console.log(`${results.length - failed}/${results.length} passed`);
    report.status = failed ? 'failed' : 'passed';
    report.exitCode = failed ? 1 : 0;
  } else {
    report.status = options.dryRun && report.commands.length ? 'planned' : report.deferredRules.length ? 'deferred-by-level' : 'no-checks';
    report.exitCode = 0;
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  const reportPath = prepareReportPath(repoRoot, options.report);
  const report = createReport(repoRoot, options);
  writeReport(reportPath, report);
  try {
    runChecks(options, report, reportPath);
  } catch (error) {
    report.status = 'failed';
    report.exitCode = 2;
    report.errors.push(error.message);
    console.error(error.message);
  } finally {
    report.finishedAt = new Date().toISOString();
    writeReport(reportPath, report);
    if (reportPath) console.log('Report: ' + reportPath);
  }
  process.exitCode = report.exitCode ?? 2;
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
