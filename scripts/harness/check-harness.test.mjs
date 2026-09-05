import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { inspectHarness } from './check-harness.mjs';
import { cleanupFixtures, createFixture, validationYaml, writeFixture } from './test-support.mjs';

afterEach(cleanupFixtures);

describe('harness structural checks', () => {
  it('accepts a complete fixture with an executable reference', () => {
    const result = inspectHarness(createFixture());
    expect(result).toMatchObject({ workspaces: 1, entryCoverage: 1, validationCoverage: 1, harnessGaps: 0 });
    expect(result.uninspectedCommands).toEqual([]);
  });

  it('finds a deleted command target even though its package name is valid', () => {
    const root = createFixture();
    fs.unlinkSync(path.join(root, 'scripts/check.cjs'));
    expect(inspectHarness(root).gaps.join('\n')).toContain('missing command target scripts/check.cjs');
  });

  it.each([false, true])('emits parseable JSON with full diagnostics (broken=%s)', (broken) => {
    const root = createFixture();
    if (broken) fs.unlinkSync(path.join(root, 'scripts/check.cjs'));
    const result = spawnSync(process.execPath, ['scripts/harness/check-harness.mjs', '--json'], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(broken ? 1 : 0);
    const output = JSON.parse(result.stdout);
    expect(output.gaps.length).toBe(output.harnessGaps);
    if (broken) expect(output.gaps.join('\n')).toContain('missing command target scripts/check.cjs');
  });

  it('finds an invalid rule before treating its arrays as commands', () => {
    const root = createFixture();
    writeFixture(root, 'packages/example/harness/validate/validation.yaml',
      validationYaml(['node scripts/check.cjs']).replace('required:', 'requried:'));
    expect(inspectHarness(root).gaps.join('\n')).toContain('unknown field requried');
  });

  it('keeps unsupported executables visible separately from structural errors', () => {
    const result = inspectHarness(createFixture(['custom-verifier --check']));
    expect(result.harnessGaps).toBe(0);
    expect(result.uninspectedCommands).toHaveLength(1);
    expect(result.uninspectedCommands[0].command).toBe('custom-verifier --check');
  });

  it('reports context size without failing a structurally valid long entry', () => {
    const root = createFixture();
    const content = '# Fixture entry\n' + 'Necessary context. '.repeat(200);
    writeFixture(root, 'AGENTS.md', content);
    writeFixture(root, 'packages/example/AGENTS.md', content);
    const result = spawnSync(process.execPath, ['scripts/harness/check-harness.mjs', '--json'], { cwd: root, encoding: 'utf8' });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.harnessGaps).toBe(0);
    expect(report.entryMetrics.map((entry) => entry.characters)).toEqual([content.length, content.length]);
  });

  it('keeps dangling document checks active regardless of entry length', () => {
    const root = createFixture();
    writeFixture(root, 'AGENTS.md', 'Context. '.repeat(200) + '\n' +
      String.fromCharCode(96) + 'harness/missing.md' + String.fromCharCode(96));
    const gaps = inspectHarness(root).gaps.join('\n');
    expect(gaps).toContain('dangling path reference harness/missing.md');
  });
});
