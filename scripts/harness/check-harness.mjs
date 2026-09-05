#!/usr/bin/env node
// Structural harness checks. Script existence is not behavioral test coverage.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { discoverWorkspaces, inspectCommand, readValidation } from './validation-data.mjs';
import { inspectDocumentReferences, markdownFiles } from './document-references.mjs';

const ABSENCE_SIGNAL = /not exist|nonexistent|absent|if present|optional|opt-in|only when|only for|only after|only if|future|later|do not|deleted|retired|removed|runtime/i;

export function inspectHarness(repoRoot, { deepDocs = false } = {}) {
  const gaps = [], uninspectedCommands = [];
  let workspaces = [];
  const read = (relative) => fs.readFileSync(path.join(repoRoot, relative), 'utf8');
  const exists = (relative) => fs.existsSync(path.join(repoRoot, relative));
  try {
    workspaces = discoverWorkspaces(repoRoot);
  } catch (error) {
    gaps.push(error.message);
  }
  const commands = new Map();
  function checkValidation(relative) {
    try {
      const data = readValidation(repoRoot, relative);
      const rules = [...data.pathRules, ...Object.entries(data.escalationRules ?? {})
        .map(([name, rule]) => ({ name, ...rule }))];
      for (const rule of rules) {
        for (const command of ['quick', 'required', 'release'].flatMap((tier) => rule[tier] ?? [])) {
          if (!commands.has(command)) commands.set(command, []);
          commands.get(command).push(relative + ' · ' + rule.name);
        }
      }
    } catch (error) {
      gaps.push(error.message);
    }
  }
  function checkRoutingLinks(relative, bases) {
    if (!exists(relative)) return;
    for (const line of read(relative).split(/\r?\n/)) {
      if (ABSENCE_SIGNAL.test(line)) continue;
      for (const match of line.matchAll(/`([^`]+)`/g)) {
        const token = match[1].replace(/\/$/, '');
        if (/[<>{}*?$|\s]/.test(token)) continue;
        if (!/^(packages|apps|harness|scripts|docs|\.github|\.pulse-coder)\/[A-Za-z0-9._/-]+$/.test(token)) continue;
        if (!bases.some((base) => exists(path.posix.join(base, token)))) {
          gaps.push(relative + ': dangling path reference ' + token);
        }
      }
    }
  }
  let entryCoverage = 0, validationCoverage = 0;
  if (!exists('AGENTS.md')) gaps.push('AGENTS.md: missing root entry');
  for (const workspace of workspaces) {
    const agents = workspace.dir + '/AGENTS.md';
    const validation = workspace.dir + '/harness/validate/validation.yaml';
    if (exists(agents)) entryCoverage += 1;
    else gaps.push(agents + ': missing workspace entry');
    if (exists(validation)) validationCoverage += 1;
    checkValidation(validation);
    checkRoutingLinks(agents, [workspace.dir, '.']);
  }
  checkValidation('harness/validate/validation.yaml');
  const docs = ['AGENTS.md'];
  if (exists('harness')) {
    for (const file of fs.readdirSync(path.join(repoRoot, 'harness'), { recursive: true })) {
      if (file.endsWith('.md')) docs.push(path.posix.join('harness', file.split(path.sep).join('/')));
    }
  }
  for (const doc of docs) checkRoutingLinks(doc, ['.', ...workspaces.map((workspace) => workspace.dir)]);
  for (const [command, sources] of commands) {
    const result = inspectCommand(command, repoRoot, workspaces);
    for (const error of result.errors) gaps.push(sources.join('; ') + ': ' + error);
    if (result.uninspected.length) uninspectedCommands.push({ command, reasons: result.uninspected, sources });
  }
  const rootCharacters = exists('AGENTS.md') ? read('AGENTS.md').length : 0;
  const introductionCharacters = exists('harness/README.md') ? read('harness/README.md').length : 0;
  const entryMetrics = ['AGENTS.md', ...workspaces.map((workspace) => workspace.dir + '/AGENTS.md')]
    .filter(exists).map((file) => ({
      file, characters: read(file).length,
      readingChainCharacters: file === 'AGENTS.md' ? rootCharacters : rootCharacters + introductionCharacters + read(file).length,
    }));
  const docWarnings = [];
  let documentsInspected = 0;
  if (deepDocs) {
    const listed = spawnSync('git', ['ls-files', '-z'], { cwd: repoRoot, encoding: 'utf8' });
    const tracked = new Set(listed.status === 0 ? listed.stdout.split('\0').filter(Boolean) : []);
    for (const workspace of workspaces) {
      for (const area of ['knowledge', 'skills']) {
        for (const file of markdownFiles(path.join(repoRoot, workspace.dir, 'harness', area))) {
          const relative = path.relative(repoRoot, file).split(path.sep).join('/');
          documentsInspected += 1;
          docWarnings.push(...inspectDocumentReferences(repoRoot, relative, workspace.dir, tracked));
        }
      }
    }
  }
  return {
    workspaces: workspaces.length, entryCoverage, validationCoverage,
    harnessGaps: gaps.length,
    uninspectedCommands, entryMetrics, characterUnit: 'UTF-16 code units',
    documentScan: { mode: deepDocs ? 'diagnostic' : 'disabled', documentsInspected }, docWarnings, gaps,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: check-harness.mjs [--deep-docs] [--json]');
    process.exit(0);
  }
  if (args.some((arg) => !['--deep-docs', '--json'].includes(arg))) {
    console.error('Unknown argument. Use --help.');
    process.exit(2);
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const result = inspectHarness(repoRoot, { deepDocs: args.includes('--deep-docs') });
  const { gaps, ...summary } = result;
  console.log(JSON.stringify(args.includes('--json') ? result : summary, null, 2));
  if (gaps.length) {
    if (!args.includes('--json')) {
      console.log('\nGaps:');
      for (const gap of gaps) console.log('- ' + gap);
    }
    process.exitCode = 1;
  }
}
