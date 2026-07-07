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
//   Add --dry-run to print the plan without executing.
//
// escalateWhen / escalationRules need human judgement (is this a public API
// change?) — they are printed as reminders, never auto-executed.

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// --- YAML subset parser (mirrors parseSimpleYaml in harness/tools/graph-viewer/server.mjs) ---

function parseScalar(value) {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function parseSimpleYaml(text) {
  const root = {};
  const stack = [{ indent: -1, value: root }];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.match(/^\s*/)[0].length;
    const line = raw.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) stack.pop();
    const parent = stack[stack.length - 1].value;

    if (line.startsWith('- ')) {
      if (!Array.isArray(parent)) continue;
      const itemText = line.slice(2).trim();
      if (!itemText) {
        const obj = {};
        parent.push(obj);
        stack.push({ indent, value: obj });
      } else if (itemText.includes(': ')) {
        const [key, ...rest] = itemText.split(':');
        const obj = { [key.trim()]: parseScalar(rest.join(':')) };
        parent.push(obj);
        stack.push({ indent, value: obj });
      } else {
        parent.push(parseScalar(itemText));
      }
      continue;
    }

    const match = line.match(/^([^:]+):(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    const rest = match[2].trim();

    if (rest) {
      parent[key] = parseScalar(rest);
      continue;
    }

    const next = lines.slice(i + 1).find((candidate) => candidate.trim() && !candidate.trimStart().startsWith('#'));
    const nextTrim = next?.trim() ?? '';
    const container = nextTrim.startsWith('- ') ? [] : {};
    parent[key] = container;
    stack.push({ indent, value: container });
  }

  return root;
}

// --- workspace discovery (pnpm-workspace.yaml is the membership SSOT) ---

function listWorkspaces() {
  const config = parseSimpleYaml(fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8'));
  const globs = Array.isArray(config.packages) ? config.packages : [];
  const dirs = [];
  for (const glob of globs) {
    if (glob.endsWith('/*')) {
      const base = glob.slice(0, -2);
      const abs = path.join(repoRoot, base);
      if (!fs.existsSync(abs)) continue;
      for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(path.posix.join(base, entry.name));
      }
    } else {
      dirs.push(glob);
    }
  }
  return dirs.filter((dir) => fs.existsSync(path.join(repoRoot, dir, 'package.json')));
}

// --- glob matching for validation.yaml `paths` entries ---

function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length;) {
    if (glob.startsWith('**/', i)) { re += '(?:.*/)?'; i += 3; continue; }
    if (glob.startsWith('**', i)) { re += '.*'; i += 2; continue; }
    if (glob[i] === '*') { re += '[^/]*'; i += 1; continue; }
    if (glob[i] === '?') { re += '[^/]'; i += 1; continue; }
    re += glob[i].replace(/[.+^${}()|[\]\\]/g, '\\$&');
    i += 1;
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(relPath, globs) {
  return (globs || []).some((glob) => globToRegExp(String(glob)).test(relPath));
}

// --- changed-path sources ---

function git(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

function pathsFromStatus() {
  return git(['status', '--porcelain', '-uall'])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .map((entry) => (entry.includes(' -> ') ? entry.split(' -> ')[1] : entry));
}

function pathsFromRange(ref) {
  return git(['diff', '--name-only', `${ref}...HEAD`]).split('\n').filter(Boolean);
}

// --- plan assembly ---

function loadValidation(relFile) {
  const abs = path.join(repoRoot, relFile);
  if (!fs.existsSync(abs)) return null;
  return parseSimpleYaml(fs.readFileSync(abs, 'utf8'));
}

function collectForWorkspace(workspace, relPaths, plan, { all = false } = {}) {
  const file = path.posix.join(workspace, 'harness/validate/validation.yaml');
  const validation = loadValidation(file);
  if (!validation) {
    plan.warnings.push(`${workspace}: no harness/validate/validation.yaml — falling back to nothing; add one.`);
    return;
  }
  for (const rule of validation.pathRules || []) {
    const hit = all || relPaths.some((p) => matchesAny(p, rule.paths));
    if (!hit) continue;
    for (const cmd of rule.required || []) plan.addCommand(cmd, `${workspace} · ${rule.name}`);
    for (const note of rule.manual || []) plan.notes.push(`${workspace} · ${rule.name} (manual): ${note}`);
    for (const note of rule.optional || []) plan.notes.push(`${workspace} · ${rule.name} (optional): ${note}`);
  }
}

function collectForRoot(rootPaths, plan, { all = false } = {}) {
  const validation = loadValidation('harness/validate/validation.yaml');
  if (!validation) return;
  for (const rule of validation.pathRules || []) {
    const hit = all || rootPaths.some((p) => matchesAny(p, rule.paths));
    if (!hit) continue;
    for (const cmd of rule.required || []) plan.addCommand(cmd, `root · ${rule.name}`);
    for (const note of rule.manual || []) plan.notes.push(`root · ${rule.name} (manual): ${note}`);
  }
}

function escalationReminders(affectedWorkspaces) {
  const validation = loadValidation('harness/validate/validation.yaml');
  const rules = validation?.escalationRules || {};
  const normalized = affectedWorkspaces.map((ws) => ws.split('/').pop().replace(/[^a-z]/gi, '').toLowerCase());
  const reminders = [];
  for (const [name, rule] of Object.entries(rules)) {
    const key = name.toLowerCase();
    if (!normalized.some((ws) => ws && key.includes(ws))) continue;
    reminders.push({ name, commands: rule.required || [] });
  }
  return reminders;
}

// --- main ---

function parseArgs(argv) {
  const options = { paths: [], all: false, dryRun: false, since: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') options.all = true;
    else if (arg === '--dry-run' || arg === '--list') options.dryRun = true;
    else if (arg === '--since') options.since = argv[++i];
    else if (arg === '--path') {
      while (argv[i + 1] && !argv[i + 1].startsWith('--')) options.paths.push(argv[++i]);
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: run-harness-check.mjs [--all] [--since <ref>] [--path <p...>] [--dry-run]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const workspaces = listWorkspaces();

  let changed = options.paths;
  if (!options.all && changed.length === 0) {
    changed = options.since ? pathsFromRange(options.since) : pathsFromStatus();
    if (changed.length === 0) {
      console.log('Working tree clean and no --path given. Use --since <ref>, --path, or --all.');
      process.exit(0);
    }
  }

  const plan = {
    commands: [],
    sources: new Map(),
    notes: [],
    warnings: [],
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
    for (const ws of workspaces) collectForWorkspace(ws, [], plan, { all: true });
    collectForRoot([], plan, { all: true });
  } else {
    const byWorkspace = new Map();
    const rootPaths = [];
    for (const p of changed) {
      const posix = p.split(path.sep).join('/');
      const owner = workspaces
        .filter((ws) => posix.startsWith(`${ws}/`))
        .sort((a, b) => b.length - a.length)[0];
      if (owner) {
        if (!byWorkspace.has(owner)) byWorkspace.set(owner, []);
        byWorkspace.get(owner).push(posix.slice(owner.length + 1));
      } else {
        rootPaths.push(posix);
      }
    }
    affected = [...byWorkspace.keys()];
    for (const [ws, rels] of byWorkspace) collectForWorkspace(ws, rels, plan);
    collectForRoot(rootPaths, plan);
  }

  console.log(`Affected workspaces: ${affected.length ? affected.join(', ') : '(none)'}`);
  for (const warning of plan.warnings) console.log(`! ${warning}`);

  if (plan.commands.length === 0) {
    console.log('No bound checks for these paths (docs-only or unruled change).');
  }

  if (options.dryRun) {
    for (const cmd of plan.commands) {
      console.log(`plan: ${cmd}   [${plan.sources.get(cmd).join('; ')}]`);
    }
  }

  const results = [];
  if (!options.dryRun) {
    for (const cmd of plan.commands) {
      console.log(`\n▶ ${cmd}   [${plan.sources.get(cmd).join('; ')}]`);
      const startedAt = Date.now();
      const run = spawnSync('sh', ['-c', cmd], { cwd: repoRoot, stdio: 'inherit' });
      results.push({ cmd, code: run.status ?? 1, seconds: ((Date.now() - startedAt) / 1000).toFixed(1) });
    }
  }

  if (plan.notes.length) {
    console.log('\nNotes (not auto-run):');
    for (const note of plan.notes) console.log(`- ${note}`);
  }

  const reminders = escalationReminders(affected);
  if (reminders.length) {
    console.log('\nEscalation reminders (run manually if the change qualifies):');
    for (const reminder of reminders) {
      console.log(`- ${reminder.name}: ${reminder.commands.join(' && ')}`);
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
    process.exit(failed ? 1 : 0);
  }
}

main();
