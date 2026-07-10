import { describe, expect, it } from 'vitest';
import { metricCoverageFailure, runFinalReportStep, runtimeReportFailure } from './report-policy.mjs';

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
