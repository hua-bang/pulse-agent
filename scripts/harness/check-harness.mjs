#!/usr/bin/env node
// Harness drift check (successor to the retired graph-viewer dashboard's
// --once mode; keeps only the load-bearing checks, no UI).
//
//   node scripts/harness/check-harness.mjs
//
// Checks, per active workspace (membership SSOT: pnpm-workspace.yaml):
//   - entry coverage:      AGENTS.md exists
//   - validation coverage: harness/validate/validation.yaml exists, parses,
//                          and every pathRule has paths + required
//   - validation matrix:   every `pnpm --filter <name>` in harness data
//                          references a real workspace package name
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
    if (!Array.isArray(rule.required) || rule.required.length === 0) gaps.push(`${label}: empty required`);
    for (const cmd of rule.required || []) checkFilterNames(String(cmd), label);
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

let entryCoverage = 0;
let validationCoverage = 0;
for (const ws of workspaces) {
  if (exists(path.posix.join(ws, 'AGENTS.md'))) entryCoverage += 1;
  else gaps.push(`${ws}: missing AGENTS.md entry`);
  const validationPath = path.posix.join(ws, 'harness/validate/validation.yaml');
  if (exists(validationPath)) validationCoverage += 1;
  checkValidationFile(validationPath, { requireRules: true });
}
checkValidationFile('harness/validate/validation.yaml', { requireRules: true });

console.log(JSON.stringify({
  workspaces: workspaces.length,
  entryCoverage,
  validationCoverage,
  harnessGaps: gaps.length,
}, null, 2));

if (gaps.length) {
  console.log('\nGaps:');
  for (const gap of gaps) console.log(`- ${gap}`);
  process.exit(1);
}
