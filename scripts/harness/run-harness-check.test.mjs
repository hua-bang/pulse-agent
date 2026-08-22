import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const run = (...args) => execFileSync(
  process.execPath,
  ['scripts/harness/run-harness-check.mjs', ...args, '--dry-run'],
  { encoding: 'utf8' },
);

describe('run-harness-check validation levels', () => {
  it('defaults changed paths to quick checks without the full suite or perf report', () => {
    const output = run('--path', 'apps/canvas-workspace/src/renderer/src/App.tsx');
    expect(output).toContain('Validation level: quick');
    expect(output).toContain('canvas-workspace typecheck');
    expect(output).toContain('ui-reuse-governance.test.ts');
    expect(output).not.toContain('canvas-workspace test   ');
    expect(output).not.toContain('perf:report');
  });

  it('adds the workspace suite at standard and performance gates at release', () => {
    const path = 'apps/canvas-workspace/src/renderer/src/App.tsx';
    const standard = run('--path', path, '--level', 'standard');
    expect(standard).toContain('pnpm --filter canvas-workspace test');
    expect(standard).not.toContain('perf:report');

    const release = run('--path', path, '--level', 'release');
    expect(release).toContain('pnpm --filter canvas-workspace test');
    expect(release).toContain('perf:report');
  });

  it('rejects unknown levels', () => {
    const result = spawnSync(
      process.execPath,
      ['scripts/harness/run-harness-check.mjs', '--level', 'turbo', '--dry-run'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Invalid --level: turbo');
  });

  it('expands a DIRECTORY --path so src/** rules bind instead of reporting no bound checks', () => {
    const output = run('--path', 'apps/canvas-workspace/src');
    expect(output).not.toContain('No bound checks');
    expect(output).toContain('canvas-workspace typecheck');
    expect(output).toContain('ui-reuse-governance.test.ts');
    // Directory expansion reaches nested rule trees (keyboard shortcuts live
    // under src/renderer/src/shortcuts/**) as well as the default src/** rule.
    expect(output).toContain('keyboard-shortcuts');
  });

  it('keeps a FILE --path binding to its exact rule without expansion', () => {
    const output = run('--path', 'apps/canvas-workspace/src/main/agent/service.ts');
    expect(output).not.toContain('No bound checks');
    expect(output).toContain('canvas-workspace typecheck');
    expect(output).toContain('canvas-contract-snapshot');
  });
});
