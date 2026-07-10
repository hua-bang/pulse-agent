import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareReportArtifacts, runtimeScenariosExist } from './report-artifacts.mjs';

let dir;

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe('performance report artifacts', () => {
  it('removes stale run outputs before producing a new report', () => {
    dir = mkdtempSync(join(tmpdir(), 'canvas-perf-report-'));
    writeFileSync(join(dir, 'scenarios-report.json'), '{"stale":true}');
    writeFileSync(join(dir, 'bundle-report.json'), '{"current":true}');
    writeFileSync(join(dir, 'renderer-trace-summary.json'), '{"stale":true}');
    writeFileSync(join(dir, 'renderer-trace.json.gz'), 'stale');
    writeFileSync(join(dir, 'dashboard.html'), 'stale');
    writeFileSync(join(dir, 'report.json'), '{"stale":true}');
    writeFileSync(join(dir, 'metrics-latest.json'), '{"stale":true}');
    writeFileSync(join(dir, 'dashboard.png'), 'stale');
    writeFileSync(join(dir, 'electron-startup.png'), 'stale');

    prepareReportArtifacts(dir);

    expect(runtimeScenariosExist(dir)).toBe(false);
    for (const file of [
      'bundle-report.json',
      'dashboard.html',
      'report.json',
      'metrics-latest.json',
      'dashboard.png',
      'electron-startup.png',
    ]) expect(() => readFileSync(join(dir, file))).toThrow();
    expect(() => readFileSync(join(dir, 'renderer-trace-summary.json'))).toThrow();
    expect(() => readFileSync(join(dir, 'renderer-trace.json.gz'))).toThrow();
  });

  it('rejects a current runtime report that contains no scenarios', () => {
    dir = mkdtempSync(join(tmpdir(), 'canvas-perf-report-'));
    prepareReportArtifacts(dir);
    writeFileSync(join(dir, 'scenarios-report.json'), '{"scenarios":{}}');

    expect(runtimeScenariosExist(dir)).toBe(false);
  });

  it('recognizes a current runtime report that contains a measured scenario', () => {
    dir = mkdtempSync(join(tmpdir(), 'canvas-perf-report-'));
    prepareReportArtifacts(dir);
    writeFileSync(join(dir, 'scenarios-report.json'), '{"scenarios":{"resize":{"report":{}}}}');

    expect(runtimeScenariosExist(dir)).toBe(true);
  });
});
