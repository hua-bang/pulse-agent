import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtures, createFixture, executeFixture, initializeFixtureGit, validationYaml, writeFixture } from './test-support.mjs';

afterEach(cleanupFixtures);

const reportPath = '.harness/validation.json';
function runReport(root, args = ['--path', 'packages/example/src/index.ts', '--level', 'standard']) {
  const result = executeFixture(root, {}, [...args, '--report', reportPath]);
  const report = JSON.parse(fs.readFileSync(path.join(root, reportPath), 'utf8'));
  return { result, report };
}

describe('validation evidence reports', () => {
  it('records executed checks with source identity and timing', () => {
    const root = createFixture();
    const head = initializeFixtureGit(root);
    writeFixture(root, 'packages/example/src/index.ts', 'export const dirty = true;');
    const { result, report } = runReport(root);
    expect(result.status, result.stderr).toBe(0);
    expect(report).toMatchObject({
      kind: 'harness-validation', schemaVersion: 1, scope: 'selected-automatic-checks',
      status: 'passed', level: 'standard', head, dirtyWorktree: true, exitCode: 0,
      source: { kind: 'path', ref: null }, paths: ['packages/example/src/index.ts'],
    });
    expect(report.commands).toHaveLength(1);
    expect(report.commands[0]).toMatchObject({ command: 'node scripts/check.cjs', status: 'passed', exitCode: 0 });
    expect(report.commands[0].durationMs).toBeGreaterThanOrEqual(0);
    expect(report.finishedAt).toBeTruthy();
  });

  it('never reports a dry run as executed success', () => {
    const { result, report } = runReport(createFixture(), ['--path', 'packages/example/src/index.ts', '--dry-run']);
    expect(result.status).toBe(0);
    expect(report.status).toBe('planned');
    expect(report.commands[0]).toMatchObject({ status: 'planned', exitCode: null, durationMs: null });
  });

  it('distinguishes executed failures from configuration errors', () => {
    const root = createFixture(['node scripts/fail.cjs']);
    writeFixture(root, 'scripts/fail.cjs', 'process.exit(7);');
    const { result, report } = runReport(root);
    expect(result.status).toBe(1);
    expect(report).toMatchObject({ status: 'failed', exitCode: 1 });
    expect(report.commands[0]).toMatchObject({ status: 'failed', exitCode: 7 });
  });

  it('keeps required manual evidence outstanding after automatic checks pass', () => {
    const root = createFixture();
    fs.appendFileSync(path.join(root, 'packages/example/harness/validate/validation.yaml'), '    manual:\n      - Open the fixture UI\n');
    const { report } = runReport(root);
    expect(report.status).toBe('passed');
    expect(report.manualChecks).toEqual([expect.objectContaining({ kind: 'manual', text: 'Open the fixture UI', status: 'not-run' })]);
  });

  it('labels unbound documentation as no-checks', () => {
    const root = createFixture();
    writeFixture(root, 'README.md', 'Documentation.');
    const { result, report } = runReport(root, ['--path', 'README.md']);
    expect(result.status).toBe(0);
    expect(report).toMatchObject({ status: 'no-checks', unmatchedPaths: ['README.md'], commands: [] });
  });

  it('rejects unbound managed source before running anything', () => {
    const root = createFixture();
    writeFixture(root, 'packages/example/harness/validate/validation.yaml', validationYaml(['node scripts/check.cjs'], ['other/**']));
    const { result, report } = runReport(root);
    expect(result.status).toBe(2);
    expect(report.status).toBe('failed');
    expect(report.errors.join('\n')).toContain('No validation rule for managed paths');
    expect(report.commands).toEqual([]);
  });

  it('distinguishes a deferred release rule from an unbound source file', () => {
    const root = createFixture();
    writeFixture(root, 'packages/example/harness/validate/validation.yaml', validationYaml(['node scripts/check.cjs']).replace('required:', 'release:'));
    const { result, report } = runReport(root, ['--path', 'packages/example/src/index.ts', '--level', 'quick']);
    expect(result.status).toBe(0);
    expect(report.status).toBe('deferred-by-level');
    expect(report.unmatchedPaths).toEqual([]);
    expect(report.deferredRules).toHaveLength(1);
  });

  it('replaces earlier success with running evidence before executing a new command', () => {
    const root = createFixture(['node scripts/observe.cjs']);
    writeFixture(root, reportPath, JSON.stringify({ kind: 'harness-validation', schemaVersion: 1, status: 'passed' }));
    writeFixture(root, 'scripts/observe.cjs', [
      "const fs = require('node:fs');",
      "const report = JSON.parse(fs.readFileSync('.harness/validation.json', 'utf8'));",
      "if (report.status !== 'running' || report.commands[0].status !== 'running') process.exit(8);",
    ].join('\n'));
    expect(runReport(root).result.status).toBe(0);
  });

  it.each([false, true])('preserves existing user files (tracked=%s)', (tracked) => {
    const root = createFixture();
    const file = 'notes.json';
    const content = JSON.stringify({ important: 'keep' });
    writeFixture(root, file, content);
    if (tracked) initializeFixtureGit(root);
    const result = executeFixture(root, {}, ['--path', 'packages/example/src/index.ts', '--report', file]);
    expect(result.status).toBe(2);
    expect(fs.readFileSync(path.join(root, file), 'utf8')).toBe(content);
  });

  it('preserves tracked empty files reached through a directory alias', () => {
    const root = createFixture();
    writeFixture(root, 'data/keep.json', '');
    initializeFixtureGit(root);
    fs.symlinkSync('data', path.join(root, 'report-alias'), 'dir');
    const result = executeFixture(root, {}, ['--path', 'AGENTS.md', '--dry-run', '--report', 'report-alias/keep.json']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('tracked file');
    expect(fs.readFileSync(path.join(root, 'data/keep.json'), 'utf8')).toBe('');
  });

  it('rejects Git metadata reached through a directory alias', () => {
    const root = createFixture();
    initializeFixtureGit(root);
    fs.symlinkSync('.git', path.join(root, 'git-alias'), 'dir');
    const result = executeFixture(root, {}, ['--path', 'AGENTS.md', '--dry-run', '--report', 'git-alias/index.lock']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Git metadata');
    expect(fs.existsSync(path.join(root, '.git/index.lock'))).toBe(false);
  });

  it('allows generated reports through an ordinary directory alias', () => {
    const root = createFixture();
    fs.mkdirSync(path.join(root, '.harness'));
    fs.symlinkSync('.harness', path.join(root, 'report-alias'), 'dir');
    const result = executeFixture(root, {}, ['--path', 'AGENTS.md', '--dry-run', '--report', 'report-alias/nested/report.json']);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(root, '.harness/nested/report.json'), 'utf8')).status).toBe('planned');
  });

  it('selects escalation reminders by paths and preserves their manual status', () => {
    const root = createFixture();
    fs.appendFileSync(path.join(root, 'harness/validate/validation.yaml'), [
      'escalationRules:', '  exampleApi:', '    paths:', '      - packages/example/src/index.ts',
      '    required:', '      - node scripts/check.cjs', '',
    ].join('\n'));
    const { report } = runReport(root);
    expect(report.escalations).toEqual([expect.objectContaining({
      name: 'exampleApi', status: 'not-run', reason: 'changed paths',
      matchedPaths: ['packages/example/src/index.ts'],
    })]);
    writeFixture(root, 'README.md', 'No contract change.');
    expect(runReport(root, ['--path', 'README.md']).report.escalations).toEqual([]);
  });
});
