import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { syncOptionalArtifacts } from '../../../../.pulse-coder/skills/perf-report/scripts/publish-artifacts.mjs';

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('performance dashboard optional artifact publishing', () => {
  it('removes stale deployed files that are absent from the current report', () => {
    const source = mkdtempSync(join(tmpdir(), 'pulse-perf-source-'));
    const target = mkdtempSync(join(tmpdir(), 'pulse-perf-target-'));
    roots.push(source, target);
    writeFileSync(join(source, 'current.json'), 'current');
    writeFileSync(join(target, 'current.json'), 'stale-current');
    writeFileSync(join(target, 'missing.json'), 'stale-missing');

    syncOptionalArtifacts(source, target, ['current.json', 'missing.json']);

    expect(readFileSync(join(target, 'current.json'), 'utf8')).toBe('current');
    expect(() => readFileSync(join(target, 'missing.json'), 'utf8')).toThrow();
  });
});
