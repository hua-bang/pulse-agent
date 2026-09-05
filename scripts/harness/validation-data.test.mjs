import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commandSegments, discoverWorkspaces, inspectCommand, matchesAny, parseYaml, readValidation, validateValidation } from './validation-data.mjs';
import { cleanupFixtures, createFixture, executeFixture, validationYaml, writeFixture } from './test-support.mjs';

afterEach(cleanupFixtures);

describe('validation data', () => {
  it('rejects duplicate YAML keys instead of overwriting an earlier rule', () => {
    expect(() => parseYaml('version: 1\nversion: 2\n', 'fixture.yaml')).toThrow(/fixture.yaml.*Map keys/s);
  });

  it.each([
    ['version', (data) => { data.version = 2; }, 'unsupported version'],
    ['unknown key', (data) => { data.pathRules[0].requried = ['node check.cjs']; }, 'unknown field requried'],
    ['duplicate name', (data) => { data.pathRules.push({ ...data.pathRules[0] }); }, 'duplicate rule name'],
    ['string commands', (data) => { data.pathRules[0].required = 'node check.cjs'; }, 'string array'],
    ['empty command', (data) => { data.pathRules[0].required = [' ']; }, 'nonempty strings'],
    ['unowned path', (data) => { data.pathRules[0].paths = ['../escape/**']; }, 'relative to their owner'],
  ])('rejects %s with a source label', (_name, mutate, message) => {
    const data = parseYaml(validationYaml(['node scripts/check.cjs']));
    mutate(data);
    expect(() => validateValidation(data, 'owner/validation.yaml')).toThrow(message);
    expect(() => validateValidation(data, 'owner/validation.yaml')).toThrow('owner/validation.yaml');
  });

  it('supports release-only rules, optional notes, and path-scoped escalation', () => {
    const data = {
      version: 1,
      pathRules: [{ name: 'perf', paths: ['src/**'], quick: [], release: ['node perf.mjs'], manual: ['Open the app'], optional: [] }],
      escalationRules: { api: { paths: ['packages/example/src/index.ts'], required: ['node consumer.mjs'] } },
    };
    expect(validateValidation(data, 'test')).toBe(data);
  });

  it('discovers membership from YAML and rejects unsupported patterns', () => {
    const root = createFixture();
    expect(discoverWorkspaces(root).map((workspace) => workspace.name)).toEqual(['@harness/example']);
    writeFixture(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/**\n');
    expect(() => discoverWorkspaces(root)).toThrow('unsupported workspace pattern');
  });

  it('fails invalid selected configuration before executing a valid command', () => {
    const root = createFixture(['node scripts/marker.cjs']);
    writeFixture(root, 'scripts/marker.cjs', "require('node:fs').writeFileSync('marker.txt', 'ran');");
    const file = 'packages/example/harness/validate/validation.yaml';
    fs.appendFileSync(path.join(root, file), '    requried:\n      - node scripts/check.cjs\n');
    const result = executeFixture(root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('unknown field requried');
    expect(fs.existsSync(path.join(root, 'marker.txt'))).toBe(false);
  });

  it('preflights every selected command before the first command executes', () => {
    const root = createFixture(['node scripts/marker.cjs', 'node scripts/missing.cjs']);
    writeFixture(root, 'scripts/marker.cjs', "require('node:fs').writeFileSync('marker.txt', 'ran');");
    const result = executeFixture(root);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('missing command target');
    expect(fs.existsSync(path.join(root, 'marker.txt'))).toBe(false);
  });

  it('keeps existing glob semantics, including zero intermediate directories', () => {
    expect(matchesAny('AGENTS.md', ['**/AGENTS.md'])).toBe(true);
    expect(matchesAny('apps/a/AGENTS.md', ['**/AGENTS.md'])).toBe(true);
    expect(matchesAny('src/nested/a.ts', ['src/*.ts'])).toBe(false);
    expect(matchesAny('src/中文 name.ts', ['src/**'])).toBe(true);
  });
});

describe('command reference inspection', () => {
  it('handles quoted arguments and an ordered conjunction without executing them', () => {
    expect(commandSegments("node 'scripts/a b.cjs' && pnpm --filter '@harness/example' test"))
      .toEqual([['node', 'scripts/a b.cjs'], ['pnpm', '--filter', '@harness/example', 'test']]);
  });

  it.each(['node script.cjs | cat', 'node $(touch marker)', 'node script.cjs; touch marker'])('leaves unsupported shell form uninspected: %s', (command) => {
    const root = createFixture();
    const result = inspectCommand(command, root, discoverWorkspaces(root));
    expect(result.errors).toEqual([]);
    expect(result.uninspected).not.toHaveLength(0);
    expect(fs.existsSync(path.join(root, 'marker'))).toBe(false);
  });

  it('detects a missing named package script', () => {
    const root = createFixture();
    const result = inspectCommand('pnpm --filter @harness/example typecheck', root, discoverWorkspaces(root));
    expect(result.errors.join(' ')).toContain('missing script typecheck');
  });

  it('checks focused test paths even when another argument exists', () => {
    const root = createFixture();
    writeFixture(root, 'packages/example/src/exists.test.ts', 'export {};');
    const result = inspectCommand('pnpm --filter @harness/example exec vitest run src/exists.test.ts src/deleted.test.ts', root, discoverWorkspaces(root));
    expect(result.errors).toEqual(['missing command target packages/example/src/deleted.test.ts']);
  });

  it('loads the exact command string from quoted YAML', () => {
    const root = createFixture(["node 'scripts/a b.cjs'"]);
    expect(readValidation(root, 'packages/example/harness/validate/validation.yaml').pathRules[0].required)
      .toEqual(["node 'scripts/a b.cjs'"]);
  });

  it('preserves ordinary backslashes inside double-quoted shell paths', () => {
    const root = createFixture(['node "scripts/keep\\name.cjs"']);
    writeFixture(root, 'scripts/keep\\name.cjs', "require('node:fs').writeFileSync('marker.txt', 'ran');");
    const result = executeFixture(root);
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(path.join(root, 'marker.txt'), 'utf8')).toBe('ran');
  });
});
