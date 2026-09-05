import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtures, commitFixture, createFixture, executeFixture, gitFixture, initializeFixtureGit, quote, repoRoot, validationYaml, workspaceRules, writeFixture } from './test-support.mjs';

afterEach(cleanupFixtures);

const run = (...args) => {
  const pathIndex = args.indexOf('--path');
  if (pathIndex >= 0) expect(fs.existsSync(path.join(repoRoot, args[pathIndex + 1])), args[pathIndex + 1]).toBe(true);
  return execFileSync(
  process.execPath,
  ['scripts/harness/run-harness-check.mjs', ...args, '--dry-run'],
  { encoding: 'utf8' },
  );
};

describe('run-harness-check validation levels', () => {
  it('defaults changed paths to quick checks without the full suite or perf report', () => {
    const output = run('--path', 'apps/canvas-workspace/src/renderer/src/app/App/index.tsx');
    expect(output).toContain('Validation level: quick');
    expect(output).toContain('canvas-workspace typecheck');
    expect(output).toContain('ui-reuse-governance.test.ts');
    expect(output).not.toContain('canvas-workspace test   ');
    expect(output).not.toContain('perf:report');
  });

  it('adds the workspace suite at standard and performance gates at release', () => {
    const path = 'apps/canvas-workspace/src/renderer/src/app/App/index.tsx';
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

describe('run-harness-check execution contracts', () => {
  it('runs selected commands from the repository root', () => {
    const root = createFixture([`${quote(process.execPath)} scripts/record-cwd.cjs`]);
    writeFixture(root, 'scripts/record-cwd.cjs', "require('node:fs').writeFileSync('observed-cwd.txt', process.cwd());\n");
    const result = executeFixture(root);
    expect(result.status, result.stderr).toBe(0);
    expect(fs.realpathSync(fs.readFileSync(path.join(root, 'observed-cwd.txt'), 'utf8')))
      .toBe(fs.realpathSync(root));
  });

  it('returns failure while still collecting independent check results', () => {
    const root = createFixture([
      `${quote(process.execPath)} scripts/fail.cjs`,
      `${quote(process.execPath)} scripts/next.cjs`,
    ]);
    writeFixture(root, 'scripts/fail.cjs', 'process.exit(9);\n');
    writeFixture(root, 'scripts/next.cjs', "require('node:fs').writeFileSync('continued.txt', 'yes');\n");
    const result = executeFixture(root);
    expect(result.status, result.stderr).toBe(1);
    expect(fs.readFileSync(path.join(root, 'continued.txt'), 'utf8')).toBe('yes');
    expect(result.stdout).toContain('1/2 passed');
  });

  it.each(['packages/agent-teams', 'apps/remote-server'])('%s binds a Node script reachable from the runner cwd', (workspace) => {
    const commands = workspaceRules(workspace).flatMap((rule) => rule.required ?? [])
      .filter((command) => command.startsWith('node '));
    expect(commands).toHaveLength(1);
    for (const command of commands) {
      const script = command.split(/\s+/)[1];
      expect(fs.existsSync(path.join(repoRoot, script)), command).toBe(true);
    }
  });

  it.each([0, 11])('the actual engine registry binding respects build exit %i', (buildExit) => {
    const rule = workspaceRules('packages/engine').find((candidate) => candidate.name === 'plugin-registry-parity');
    expect(rule?.required.length).toBeGreaterThan(0);
    const root = createFixture(rule.required);
    writeFixture(root, 'packages/engine/package.json', JSON.stringify({ name: 'pulse-coder-engine', scripts: { build: 'tsup' } }));
    writeFixture(root, 'packages/engine/harness/validate/validation.yaml', validationYaml(['pnpm --filter pulse-coder-engine build']));
    const pnpm = writeFixture(root, 'bin/pnpm', '#!/bin/sh\nprintf "%s\\n" "$*" > build-args.txt\nexit "$HARNESS_FIXTURE_BUILD_EXIT"\n');
    fs.chmodSync(pnpm, 0o755);
    writeFixture(root, 'packages/engine/harness/tools/describe-engine.mjs',
      "import fs from 'node:fs'; fs.writeFileSync('descriptor-ran.txt', 'yes');\n");
    const result = executeFixture(root, {
      PATH: `${path.join(root, 'bin')}${path.delimiter}${process.env.PATH ?? ''}`,
      HARNESS_FIXTURE_BUILD_EXIT: String(buildExit),
    });
    expect(result.status, result.stderr).toBe(buildExit === 0 ? 0 : 1);
    expect(fs.readFileSync(path.join(root, 'build-args.txt'), 'utf8').trim())
      .toBe('--filter pulse-coder-engine build');
    expect(fs.existsSync(path.join(root, 'descriptor-ran.txt'))).toBe(buildExit === 0);
  });
});

describe('changed-path selection', () => {
  const affected = (result) => result.stdout.split('\n').find((line) => line.startsWith('Affected workspaces:'));

  it.each([
    ['packages/acp', 'src/index.ts'],
    ['packages/agent-teams', 'src/index.ts'],
    ['packages/canvas-cli', 'src/index.ts'],
    ['packages/cli', 'src/index.ts'],
    ['packages/engine', 'src/index.ts'],
    ['packages/plugin-kit', 'src/index.ts'],
    ['apps/remote-server', 'src/server.ts'],
    ['apps/canvas-workspace', 'src/renderer/src/app/App/index.tsx'],
  ])('routes a real source file in %s', (workspace, file) => {
    const output = run('--path', workspace + '/' + file);
    expect(output.split('\n').find((line) => line.startsWith('Affected workspaces:')))
      .toBe('Affected workspaces: ' + workspace);
  });

  it('keeps CJK and spaces intact when reading untracked status paths', () => {
    const root = createFixture();
    initializeFixtureGit(root);
    writeFixture(root, 'packages/example/src/中文 name.ts', 'export {};');
    const result = executeFixture(root, {}, ['--dry-run']);
    expect(result.status, result.stderr).toBe(0);
    expect(affected(result)).toContain('packages/example');
  });

  it.each(['status', 'range'])('includes both workspace owners of a %s rename', (mode) => {
    const root = createFixture();
    writeFixture(root, 'packages/second/package.json', JSON.stringify({ name: '@harness/second' }));
    writeFixture(root, 'packages/second/AGENTS.md', '# Second fixture\n');
    writeFixture(root, 'packages/second/src/.keep', '');
    writeFixture(root, 'scripts/second.cjs', 'process.exit(0);');
    writeFixture(root, 'packages/second/harness/validate/validation.yaml', validationYaml(['node scripts/second.cjs']));
    const base = initializeFixtureGit(root);
    gitFixture(root, 'mv', 'packages/example/src/index.ts', 'packages/second/src/renamed.ts');
    if (mode === 'range') commitFixture(root);
    const args = mode === 'range' ? ['--since', base, '--dry-run'] : ['--dry-run'];
    const result = executeFixture(root, {}, args);
    expect(result.status, result.stderr).toBe(0);
    expect(affected(result)).toContain('packages/example');
    expect(affected(result)).toContain('packages/second');
  });

  it('uses committed range changes without silently adding dirty files', () => {
    const root = createFixture();
    const base = initializeFixtureGit(root);
    writeFixture(root, 'README.md', 'A committed documentation change.');
    commitFixture(root);
    writeFixture(root, 'packages/example/src/index.ts', 'export const dirty = true;');
    const result = executeFixture(root, {}, ['--since', base, '--dry-run']);
    expect(result.status, result.stderr).toBe(0);
    expect(affected(result)).toBe('Affected workspaces: (none)');
  });

  it('keeps a deleted source path eligible for its owning checks', () => {
    const root = createFixture();
    initializeFixtureGit(root);
    fs.unlinkSync(path.join(root, 'packages/example/src/index.ts'));
    const result = executeFixture(root, {}, ['--dry-run']);
    expect(result.status, result.stderr).toBe(0);
    expect(affected(result)).toContain('packages/example');
  });

  it('normalizes explicit relative and absolute paths within the repository', () => {
    const root = createFixture();
    for (const file of ['./packages/example/src/index.ts', path.join(root, 'packages/example/src/index.ts')]) {
      const result = executeFixture(root, {}, ['--path', file, '--dry-run']);
      expect(result.status, result.stderr).toBe(0);
      expect(affected(result)).toContain('packages/example');
    }
  });

  it('expands directory paths without traversing ignored generated files', () => {
    const root = createFixture();
    initializeFixtureGit(root);
    writeFixture(root, 'scripts/ignored.cjs', 'process.exit(0);');
    writeFixture(root, 'packages/example/node_modules/generated.ts', 'export {};');
    fs.appendFileSync(path.join(root, 'packages/example/harness/validate/validation.yaml'), [
      '  - name: generated', '    paths:', '      - node_modules/**',
      '    required:', '      - node scripts/ignored.cjs', '',
    ].join('\n'));
    const result = executeFixture(root, {}, ['--path', 'packages/example', '--dry-run']);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('scripts/check.cjs');
    expect(result.stdout).not.toContain('scripts/ignored.cjs');
  });

  it.each([
    ['--path'], ['--since'], ['--level'], ['--all', '--path', 'AGENTS.md'],
    ['--path', '../outside.ts'], ['--since', '--output=/tmp/should-not-exist'],
  ])('rejects invalid selection arguments %j', (...args) => {
    const root = createFixture();
    const result = executeFixture(root, {}, args);
    expect(result.status).toBe(2);
  });

  it('includes Canvas acceptance for lockfile-only changes', () => {
    const output = run('--path', 'pnpm-lock.yaml', '--level', 'standard');
    expect(output).toContain('pnpm run build');
    expect(output).toContain('pnpm test');
    expect(output).toContain('canvas-workspace typecheck');
    expect(output).toContain('canvas-workspace test');
  });

  it('binds performance-policy tests to workflow changes', () => {
    const output = run('--path', '.github/workflows/perf.yml');
    expect(output).toContain('scripts/perf/report-policy.test.mjs');
  });

  it.each([
    'config/index.ts', 'core/loop.ts', 'ai/index.ts', 'context/index.ts',
    'tools/index.ts', 'built-in/skills-plugin/index.ts', 'orchestrator/index.ts',
  ])('retains consumer reminders for exported declarations in engine %s', (file) => {
    const output = run('--path', 'packages/engine/src/' + file);
    expect(output).toContain('enginePublicApiChange');
    expect(output).toContain('pnpm --filter pulse-coder-acp typecheck');
  });
});
