import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtures, commitFixture, createFixture, gitFixture, initializeFixtureGit, repoRoot, writeFixture } from '../../../../scripts/harness/test-support.mjs';

afterEach(cleanupFixtures);
import { classifyPerformanceChanges, metricCoverageFailure, runFinalReportStep, runtimeReportFailure } from './report-policy.mjs';

describe('runtimeReportFailure', () => {
  it('rejects a full report when the app failed to launch', () => {
    expect(runtimeReportFailure({ bundleOnly: false, launchFailed: true, scenariosRan: false }))
      .toBe('application launch failed');
  });

  it('rejects a full report when runtime scenarios did not run', () => {
    expect(runtimeReportFailure({ bundleOnly: false, launchFailed: false, scenariosRan: false }))
      .toBe('runtime scenarios did not run');
  });

  it('accepts an explicit bundle-only report without runtime scenarios', () => {
    expect(runtimeReportFailure({ bundleOnly: true, launchFailed: false, scenariosRan: false }))
      .toBeNull();
  });

  it('accepts a full report after runtime scenarios run', () => {
    expect(runtimeReportFailure({ bundleOnly: false, launchFailed: false, scenariosRan: true }))
      .toBeNull();
  });
});

describe('runFinalReportStep', () => {
  it('runs the dashboard before rejecting an incomplete runtime report', () => {
    const calls = [];
    const result = runFinalReportStep({
      bundleOnly: false,
      launchFailed: true,
      scenariosRan: false,
      gatesFailed: false,
      runDashboard: () => {
        calls.push('dashboard');
        return 0;
      },
    });

    expect(calls).toEqual(['dashboard']);
    expect(result).toEqual({
      gatesFailed: true,
      runtimeFailure: 'application launch failed',
    });
  });

  it('includes a dashboard failure in the final gate state', () => {
    const result = runFinalReportStep({
      bundleOnly: true,
      launchFailed: false,
      scenariosRan: false,
      gatesFailed: false,
      runDashboard: () => 1,
    });

    expect(result).toEqual({ gatesFailed: true, runtimeFailure: null });
  });
});

describe('metricCoverageFailure', () => {
  it('requires complete metric coverage for a full report', () => {
    expect(metricCoverageFailure({ bundleOnly: false, coverage: { measured: 39, total: 40 } }))
      .toBe('metric coverage is incomplete (39/40)');
    expect(metricCoverageFailure({ bundleOnly: false, coverage: { measured: 40, total: 40 } }))
      .toBeNull();
  });

  it('allows partial coverage for an explicit bundle-only report', () => {
    expect(metricCoverageFailure({ bundleOnly: true, coverage: { measured: 6, total: 40 } }))
      .toBeNull();
  });

  it('keeps optional diagnostic coverage outside the core failure contract', () => {
    expect(metricCoverageFailure({
      bundleOnly: false,
      coverage: {
        measured: 40,
        total: 40,
        diagnostic: { measured: 0, total: 7, status: 'unavailable' },
      },
    })).toBeNull();
  });
});


describe('performance change classification', () => {
  const canvas = 'apps/canvas-workspace/src/renderer/src/modules/canvas/components/canvas/Canvas/index.tsx';
  const workbench = 'apps/canvas-workspace/src/renderer/src/app/shell/Workbench/index.tsx';
  const iframe = 'apps/canvas-workspace/src/renderer/src/modules/canvas/components/node-bodies/IframeNodeBody/index.tsx';
  const settings = 'apps/canvas-workspace/src/renderer/src/modules/settings/internal/Settings/AgentSection.tsx';
  const storage = 'packages/storage/src/sqlite/canvas.ts';
  const cliNative = 'packages/canvas-cli/scripts/prepare-native.mjs';
  const electronNative = 'apps/canvas-workspace/scripts/setup/prepare-sqlite-native.mjs';
  const workflow = () => parse(fs.readFileSync(path.join(repoRoot, '.github/workflows/perf.yml'), 'utf8'));

  it.each([canvas, workbench, iframe])('recognizes the current hot path %s', (file) => {
    expect(fs.existsSync(path.join(repoRoot, file)), file).toBe(true);
    expect(classifyPerformanceChanges({ paths: [file] })).toEqual({ runtime: true, packaging: false });
  });

  it.each(['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'])('runs compatibility checks for %s and exposes it to CI', (file) => {
    expect(classifyPerformanceChanges({ paths: [file] })).toEqual({ runtime: true, packaging: true });
    expect(workflow().on.pull_request.paths).toContain(file);
    expect(workflow().on.push.paths).toContain(file);
  });

  it.each([
    [storage, 'packages/storage/**'],
    ['packages/storage/package.json', 'packages/storage/**'],
    ['packages/canvas-cli/src/core/sqlite-store.ts', 'packages/canvas-cli/**'],
    [cliNative, 'packages/canvas-cli/**'],
    [electronNative, 'apps/canvas-workspace/**'],
  ])('runs runtime and packaging checks for %s', (file, trigger) => {
    expect(fs.existsSync(path.join(repoRoot, file)), file).toBe(true);
    expect(classifyPerformanceChanges({ paths: [file] })).toEqual({ runtime: true, packaging: true });
    expect(workflow().on.pull_request.paths).toContain(trigger);
    expect(workflow().on.push.paths).toContain(trigger);
  });

  it('runs runtime checks for the Canvas storage adapter without forcing a package build', () => {
    expect(classifyPerformanceChanges({ paths: ['apps/canvas-workspace/src/main/canvas/persistence/backend.ts'] }))
      .toEqual({ runtime: true, packaging: false });
  });

  it.each(['perf', 'large-canvas'])('prepares the Electron ABI after workspace builds and before %s launches', job => {
    const steps = workflow().jobs[job].steps;
    const build = steps.findIndex(step => step.run === 'pnpm run build:core');
    const prepare = steps.findIndex(step => step.run === 'pnpm --filter canvas-workspace prepare:agent-tooling');
    const launch = steps.findIndex(step => step.run?.startsWith('pnpm --filter canvas-workspace perf:report'));
    expect(build).toBeGreaterThan(-1);
    expect(prepare).toBeGreaterThan(build);
    expect(launch).toBeGreaterThan(prepare);
  });

  it('keeps ordinary settings UI changes on the bundle-only path', () => {
    expect(fs.existsSync(path.join(repoRoot, settings))).toBe(true);
    expect(classifyPerformanceChanges({ paths: [settings] })).toEqual({ runtime: false, packaging: false });
  });

  it('preserves explicit labels, dispatch, and default-branch event behavior', () => {
    expect(classifyPerformanceChanges({ performanceLabel: true })).toEqual({ runtime: true, packaging: true });
    expect(classifyPerformanceChanges({ eventName: 'workflow_dispatch' })).toEqual({ runtime: true, packaging: true });
    expect(classifyPerformanceChanges({ eventName: 'push' })).toEqual({ runtime: true, packaging: true });
  });

  it('keeps the existing package-only trigger and rejects lookalike directory prefixes', () => {
    expect(classifyPerformanceChanges({ paths: ['apps/canvas-workspace/package.json'] }))
      .toEqual({ runtime: false, packaging: true });
    for (const file of [
      'apps/canvas-workspace/src/renderer/src/modules/canvas-extra/index.tsx',
      'packages/storage-extra/src/index.ts', 'packages/canvas-cli-extra/src/index.ts',
    ]) {
      expect(classifyPerformanceChanges({ paths: [file] })).toEqual({ runtime: false, packaging: false });
    }
  });

  it.each(['canvas', 'lockfile', 'rename', 'storage', 'cli-native', 'electron-native'])('executes the real workflow classifier for a %s change', (kind) => {
    const root = createFixture();
    writeFixture(root, 'apps/canvas-workspace/scripts/perf/report-policy.mjs',
      fs.readFileSync(path.join(repoRoot, 'apps/canvas-workspace/scripts/perf/report-policy.mjs')));
    if (kind === 'rename') writeFixture(root, canvas, 'export const fixture = true;');
    const base = initializeFixtureGit(root);
    if (kind === 'rename') {
      fs.mkdirSync(path.dirname(path.join(root, settings)), { recursive: true });
      gitFixture(root, 'mv', canvas, settings);
    } else {
      const files = { canvas, lockfile: 'pnpm-lock.yaml', storage, 'cli-native': cliNative, 'electron-native': electronNative };
      writeFixture(root, files[kind], 'fixture-change');
    }
    const head = commitFixture(root);
    const output = path.join(root, 'github-output.txt');
    const step = workflow().jobs.changes.steps.find((candidate) => candidate.id === 'classify');
    const result = spawnSync('bash', ['-c', step.run], {
      cwd: root, encoding: 'utf8',
      env: {
        ...process.env, GITHUB_OUTPUT: output,
        HARNESS_EVENT_NAME: 'pull_request', HARNESS_BASE_SHA: base, HARNESS_HEAD_SHA: head,
        HARNESS_PERFORMANCE_LABEL: 'false',
      },
    });
    expect(result.status, result.stderr).toBe(0);
    const packaging = !['canvas', 'rename'].includes(kind);
    expect(fs.readFileSync(output, 'utf8')).toBe('runtime=true\npackaging=' + packaging + '\n');
  });
});
