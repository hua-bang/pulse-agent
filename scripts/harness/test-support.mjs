import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readValidation } from './validation-data.mjs';

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const fixtures = [];
export const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";

export function cleanupFixtures() {
  for (const fixture of fixtures.splice(0)) fs.rmSync(fixture, { recursive: true, force: true });
}

export function writeFixture(root, file, content) {
  const target = path.join(root, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  return target;
}

export function validationYaml(commands, paths = ['src/**', 'package.json']) {
  return [
    'version: 1', 'pathRules:', '  - name: fixture', '    paths:',
    ...paths.map((item) => '      - ' + JSON.stringify(item)),
    '    required:', ...commands.map((command) => '      - ' + JSON.stringify(command)), '',
  ].join('\n');
}

export function createFixture(commands = ['node scripts/check.cjs']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-fixture-'));
  fixtures.push(root);
  for (const file of ['run-harness-check.mjs', 'check-harness.mjs', 'validation-data.mjs', 'report.mjs', 'document-references.mjs']) {
    writeFixture(root, 'scripts/harness/' + file, fs.readFileSync(path.join(repoRoot, 'scripts/harness', file)));
  }
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true });
  fs.symlinkSync(fs.realpathSync(path.join(repoRoot, 'node_modules/yaml')), path.join(root, 'node_modules/yaml'), 'dir');
  writeFixture(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  writeFixture(root, '.gitignore', 'node_modules/\ndist/\n.harness/\n');
  writeFixture(root, 'package.json', JSON.stringify({ name: '@harness/root', scripts: { check: 'node scripts/check.cjs' } }));
  writeFixture(root, 'AGENTS.md', '# Fixture root\n');
  writeFixture(root, 'scripts/check.cjs', 'process.exit(0);\n');
  writeFixture(root, 'harness/validate/validation.yaml', validationYaml(['node scripts/check.cjs'], ['AGENTS.md']));
  writeFixture(root, 'packages/example/package.json', JSON.stringify({ name: '@harness/example', scripts: { test: 'vitest run' } }));
  writeFixture(root, 'packages/example/AGENTS.md', '# Fixture workspace\n');
  writeFixture(root, 'packages/example/src/index.ts', 'export {};\n');
  writeFixture(root, 'packages/example/harness/validate/validation.yaml', validationYaml(commands));
  return root;
}

export function executeFixture(root, env = {}, args = ['--path', 'packages/example/src/index.ts', '--level', 'standard']) {
  return spawnSync(process.execPath, [path.join(root, 'scripts/harness/run-harness-check.mjs'), ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...env },
  });
}

export function workspaceRules(workspace) {
  return readValidation(repoRoot, workspace + '/harness/validate/validation.yaml').pathRules;
}

export function gitFixture(root, ...args) {
  const result = spawnSync('git', [
    '-c', 'user.name=Harness Fixture', '-c', 'user.email=harness@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=' + path.join(root, '.git/hooks'),
    ...args,
  ], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

export function commitFixture(root) {
  gitFixture(root, 'add', '--all');
  gitFixture(root, 'commit', '--quiet', '--allow-empty', '-m', 'Fixture snapshot');
  return gitFixture(root, 'rev-parse', 'HEAD');
}

export function initializeFixtureGit(root) {
  gitFixture(root, 'init', '--quiet');
  return commitFixture(root);
}
