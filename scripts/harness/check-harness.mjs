#!/usr/bin/env node
// Harness drift check (successor to the retired graph-viewer dashboard's
// --once mode; keeps only the load-bearing checks, no UI).
//
//   node scripts/harness/check-harness.mjs
//
// Checks, per active workspace (membership SSOT: pnpm-workspace.yaml):
//   - entry coverage:      AGENTS.md exists
//   - validation coverage: harness/validate/validation.yaml exists, parses,
//                          and every pathRule has paths + at least one command tier
//   - validation matrix:   every `pnpm --filter <name>` in harness data
//                          references a real workspace package name
//   - routing links:       backticked concrete repo paths in root AGENTS.md,
//                          harness/*.md, and workspace AGENTS.md files exist
//                          on disk (placeholders and globs are skipped)
//   - router-weight:       no line in root or workspace AGENTS.md exceeds
//                          ROUTER_WEIGHT_THRESHOLD chars — an over-long line
//                          is inline knowledge that belongs in
//                          harness/knowledge/ plus a short pointer row
// Plus the root overlay file, same shape rules.
//
// Prints a summary and exits non-zero when gaps exist. The runner
// (run-harness-check.mjs) invokes this automatically for harness-data paths.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSimpleYaml } from './simple-yaml.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(repoRoot, rel));
}

function listWorkspaces() {
  const config = parseSimpleYaml(read('pnpm-workspace.yaml'));
  const dirs = [];
  for (const glob of config.packages || []) {
    if (glob.endsWith('/*')) {
      const base = glob.slice(0, -2);
      if (!exists(base)) continue;
      for (const entry of fs.readdirSync(path.join(repoRoot, base), { withFileTypes: true })) {
        if (entry.isDirectory()) dirs.push(path.posix.join(base, entry.name));
      }
    } else {
      dirs.push(glob);
    }
  }
  return dirs.filter((dir) => exists(path.posix.join(dir, 'package.json')));
}

const gaps = [];
const workspaces = listWorkspaces();
const packageNames = new Set(
  workspaces.map((ws) => JSON.parse(read(path.posix.join(ws, 'package.json'))).name),
);

function checkValidationFile(rel, { requireRules }) {
  if (!exists(rel)) {
    if (requireRules) gaps.push(`${rel}: missing`);
    return;
  }
  let data;
  try {
    data = parseSimpleYaml(read(rel));
  } catch (error) {
    gaps.push(`${rel}: unparsable (${error.message})`);
    return;
  }
  const rules = data.pathRules;
  if (!Array.isArray(rules) || rules.length === 0) {
    gaps.push(`${rel}: no pathRules`);
    return;
  }
  for (const rule of rules) {
    const label = `${rel} · ${rule.name || '(unnamed rule)'}`;
    if (!Array.isArray(rule.paths) || rule.paths.length === 0) gaps.push(`${label}: empty paths`);
    const commands = ['quick', 'required', 'release']
      .flatMap((tier) => (Array.isArray(rule[tier]) ? rule[tier] : []));
    if (commands.length === 0) gaps.push(`${label}: no quick, required, or release commands`);
    for (const cmd of commands) checkFilterNames(String(cmd), label);
  }
  for (const [name, rule] of Object.entries(data.escalationRules || {})) {
    for (const cmd of rule.required || []) checkFilterNames(String(cmd), `${rel} · ${name}`);
  }
}

function checkFilterNames(cmd, label) {
  for (const match of cmd.matchAll(/--filter\s+("[^"]+"|\S+)/g)) {
    const name = match[1].replace(/"/g, '');
    if (name.startsWith('./') || name.includes('*')) continue;
    if (!packageNames.has(name)) gaps.push(`${label}: --filter ${name} matches no workspace package`);
  }
}

// router-weight: AGENTS.md is a router — knowledge that accumulates inline
// (instead of living in harness/knowledge/ with a pointer row) makes it
// unreadable and hard to keep honest. A line length cap is a cheap, mechanical
// proxy for "this bullet stopped being a pointer and became the knowledge
// itself." Measured in JS string length (UTF-16 code units), same as the
// comparison below; byte-counting tools (e.g. `awk`) read slightly higher on
// lines with multi-byte characters (em dashes, arrows) that are common here.
//
// Floor is 800 (round, far under the old fat rows this was written to catch:
// 1500-5006 chars). RATCHET history: started at 810 because root AGENTS.md
// §6's oldest "Failure capture" bullets ran to ~803 chars; those bullets now
// live in their owning workspaces' harness/knowledge/, so the gate sits at
// the 800 floor. Do not raise it to silence a new violation — slim the line
// instead (harness/skills/slim-agents-md/SKILL.md).
const ROUTER_WEIGHT_THRESHOLD = 800;

function checkRouterWeight(rel) {
  if (!exists(rel)) return;
  const lines = read(rel).split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.length <= ROUTER_WEIGHT_THRESHOLD) return;
    gaps.push(
      `${rel}:${index + 1}: router-weight ${line.length} chars (>${ROUTER_WEIGHT_THRESHOLD}) — move this knowledge into harness/knowledge/ and leave a short pointer row in its place`,
    );
  });
}

let entryCoverage = 0;
let validationCoverage = 0;
for (const ws of workspaces) {
  const agentsPath = path.posix.join(ws, 'AGENTS.md');
  if (exists(agentsPath)) entryCoverage += 1;
  else gaps.push(`${ws}: missing AGENTS.md entry`);
  checkRouterWeight(agentsPath);
  const validationPath = path.posix.join(ws, 'harness/validate/validation.yaml');
  if (exists(validationPath)) validationCoverage += 1;
  checkValidationFile(validationPath, { requireRules: true });
}
checkValidationFile('harness/validate/validation.yaml', { requireRules: true });
checkRouterWeight('AGENTS.md');

// routing-links: a doc that points at a deleted/renamed file is worse than no
// doc. Only tokens that look like concrete repo paths are checked. Docs also
// legitimately talk about paths that do not exist — honest-absence lists,
// conditional/future references, runtime-created artifacts — and such lines
// carry a lexical signal, so they are skipped rather than flagged.
const ABSENCE_SIGNAL = /not exist|nonexistent|absent|if present|optional|opt-in|only when|only for|only after|only if|future|later|do not|deleted|retired|removed|runtime/i;

function checkRoutingLinks(docRel, baseDirs) {
  if (!exists(docRel)) return;
  for (const line of read(docRel).split(/\r?\n/)) {
    if (ABSENCE_SIGNAL.test(line)) continue;
    for (const match of line.matchAll(/`([^`]+)`/g)) {
      const token = match[1].replace(/\/$/, '');
      if (/[<>{}*?$|\s]/.test(token)) continue;
      if (!/^(packages|apps|harness|scripts|docs|\.github|\.pulse-coder)\/[A-Za-z0-9._\/-]+$/.test(token)) continue;
      const found = baseDirs.some((base) => exists(path.posix.join(base, token)));
      if (!found) gaps.push(`${docRel}: dangling path reference \`${token}\``);
    }
  }
}

const docs = ['AGENTS.md'];
for (const entry of fs.readdirSync(path.join(repoRoot, 'harness'), { recursive: true })) {
  const rel = path.posix.join('harness', String(entry).split(path.sep).join('/'));
  if (rel.endsWith('.md')) docs.push(rel);
}
for (const doc of docs) checkRoutingLinks(doc, ['.', ...workspaces]);
for (const ws of workspaces) checkRoutingLinks(path.posix.join(ws, 'AGENTS.md'), [ws, '.']);

console.log(JSON.stringify({
  workspaces: workspaces.length,
  entryCoverage,
  validationCoverage,
  routerWeightThreshold: ROUTER_WEIGHT_THRESHOLD,
  harnessGaps: gaps.length,
}, null, 2));

if (gaps.length) {
  console.log('\nGaps:');
  for (const gap of gaps) console.log(`- ${gap}`);
  process.exit(1);
}
